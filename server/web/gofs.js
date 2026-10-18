// A Node-style fs for Go's WebAssembly runtime (Go's syscall/fs_js.go calls globalThis.fs with callbacks), in the
// worker (worker.js). Mounts:
//   /game  the Helldivers 2 folder the user chose, read-only: the File objects of a folder file input, or
//          (automated tests) a folder served over HTTP with Range requests and a file list
//   /home  the browser's private storage (OPFS): settings, the model cache (and projects when no folder is chosen)
//   /projects  the projects folder on disk the user chose (Chrome / Edge: a read-write directory handle)
// Writes go through OPFS sync access handles (workers only); reads of a file nobody writes use File slices.
(() => {
  const C = { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_NOCTTY: 256, O_TRUNC: 512,
    O_APPEND: 1024, O_DIRECTORY: 65536, O_SYNC: 1052672 };
  const S_IFDIR = 0o40000, S_IFREG = 0o100000;
  const fail = (code, what) => Object.assign(new Error(`${code}: ${what ?? ''}`), { code });

  let game = null;            // { files: Map(path -> size), objs: Map(path -> File) | null, base: URL ('' for objs), dirs: Map(path -> Set(name)) }
  let home = null;            // OPFS root directory handle
  let projects = null;        // the projects folder on disk the user chose (a directory handle, read-write), if any
  const fds = new Map();
  let nextFd = 10;
  const writers = new Map();  // home path -> open sync access handle (one writer per file)
  const out = { 1: '', 2: '' };

  // '/a/./b/../c' -> ['a', 'c']
  const segs = p => {
    const r = [];
    for (const s of String(p).split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') r.pop(); else r.push(s);
    }
    return r;
  };
  const norm = p => '/' + segs(p).join('/');

  const errOf = e => {
    if (e?.code && typeof e.code === 'string') return e;
    switch (e?.name) {
      case 'NotFoundError': return fail('ENOENT', e.message);
      case 'TypeMismatchError': return fail('ENOTDIR', e.message);
      case 'InvalidModificationError': return fail('ENOTEMPTY', e.message);
      case 'NoModificationAllowedError': return fail('EBUSY', e.message);
      case 'NotAllowedError': case 'SecurityError': return fail('EACCES', e.message);
      default: return fail('EIO', e?.message ?? String(e));
    }
  };

  // a handle (or for HTTP game folders a descriptor) of an absolute path: {mount, kind: 'dir'|'file', handle, size}
  async function lookup(path) {
    const s = segs(path);
    if (s.length === 0) return { mount: 'root', kind: 'dir' };
    const [m, ...rest] = s;
    if (m === 'game') {
      if (!game) throw fail('ENOENT', path);
      if (game.files) {
        const key = rest.join('/');
        if (game.objs?.has(key)) return { mount: 'game', kind: 'file', obj: game.objs.get(key) };
        if (game.files.has(key)) return { mount: 'game', kind: 'file', size: game.files.get(key), url: game.base + key };
        if (key === '' || game.dirs.has(key)) return { mount: 'game', kind: 'dir', key };
        throw fail('ENOENT', path);
      }
      throw fail('ENOENT', path);
    }
    if (m === 'home') {
      if (!home) throw fail('ENOENT', path);
      return { mount: 'home', ...(await walk(home, rest, '/home', null)) };
    }
    if (m === 'projects') {
      if (!projects) throw fail('ENOENT', path);
      return { mount: 'projects', ...(await walk(projects, rest, '/projects', null)) };
    }
    throw fail('ENOENT', path);
  }
  async function walk(root, rest, prefix, cache) {
    let dir = root, at = prefix;
    for (let i = 0; i < rest.length; i++) {
      const name = rest[i], last = i === rest.length - 1;
      at += '/' + name;
      let h = cache?.get(at);
      if (!h) {
        try { h = await dir.getDirectoryHandle(name); }
        catch (e) {
          if (!last || (e.name !== 'TypeMismatchError' && e.name !== 'NotFoundError')) throw errOf(e);
          try { h = await dir.getFileHandle(name); } catch (e2) { throw errOf(e2); }
        }
        cache?.set(at, h);
      }
      if (!last) {
        if (h.kind !== 'directory') throw fail('ENOTDIR', at);
        dir = h;
      } else return { kind: h.kind === 'directory' ? 'dir' : 'file', handle: h, parent: dir, name };
    }
    return { kind: 'dir', handle: root };
  }
  // the parent directory handle and the last name of a /home path (for creating, removing, renaming)
  async function parentOf(path) {
    const s = segs(path);
    if ((s[0] !== 'home' && s[0] !== 'projects') || s.length < 2) throw fail('EACCES', path);
    const p = await lookup('/' + s.slice(0, -1).join('/'));
    if (p.kind !== 'dir') throw fail('ENOTDIR', path);
    return { dir: p.handle, name: s[s.length - 1] };
  }

  const statOf = (kind, size, mtime) => {
    const t = mtime ?? Date.now();
    return { dev: 1, ino: 0, mode: kind === 'dir' ? S_IFDIR | 0o755 : S_IFREG | 0o644, nlink: 1, uid: 0, gid: 0, rdev: 0,
      size: size ?? 0, blksize: 4096, blocks: Math.ceil((size ?? 0) / 512), atimeMs: t, mtimeMs: t, ctimeMs: t,
      isDirectory() { return kind === 'dir'; }, isFile() { return kind === 'file'; } };
  };
  async function stat(path) {
    const e = await lookup(path);
    if (e.kind === 'dir') return statOf('dir', 0);
    if (e.url) return statOf('file', e.size, 0);
    if (e.obj) return statOf('file', e.obj.size, e.obj.lastModified);
    const w = writers.get(norm(path));
    if (w) return statOf('file', w.getSize());
    const f = await e.handle.getFile();
    return statOf('file', f.size, f.lastModified);
  }

  // a writer for a file in a folder on disk (the projects folder): such files have no sync access handle (OPFS only),
  // so the file is kept in memory and written with createWritable when flushed or closed; same calls as a sync handle
  async function bufferedWriter(handle, truncate) {
    let data = new Uint8Array(0), size = 0, dirty = truncate;
    if (!truncate) { data = new Uint8Array(await (await handle.getFile()).arrayBuffer()); size = data.length; }
    const grow = n => {
      if (n <= data.length) return;
      const d = new Uint8Array(Math.max(n, data.length * 2, 4096));
      d.set(data.subarray(0, size)); data = d;
    };
    return {
      read(view, { at }) { const n = Math.max(0, Math.min(view.length, size - at)); view.set(data.subarray(at, at + n)); return n; },
      write(view, { at }) { grow(at + view.length); data.set(view, at); size = Math.max(size, at + view.length); dirty = true; return view.length; },
      getSize: () => size,
      truncate(n) { grow(n); if (n > size) data.fill(0, size, n); size = n; dirty = true; },
      async flush() {
        if (!dirty) return;
        const w = await handle.createWritable();
        await w.write(data.slice(0, size)); await w.close();
        dirty = false;
      },
      async close() { await this.flush(); },
    };
  }

  async function open(path, flags, mode) {
    path = norm(path);
    const acc = flags & 3, write = acc !== C.O_RDONLY;
    let e;
    try { e = await lookup(path); }
    catch (err) {
      if (err.code !== 'ENOENT' || !(flags & C.O_CREAT)) throw err;
      const { dir, name } = await parentOf(path);
      const h = await dir.getFileHandle(name, { create: true }).catch(x => { throw errOf(x); });
      e = { mount: segs(path)[0], kind: 'file', handle: h, created: true };
    }
    if ((flags & C.O_CREAT) && (flags & C.O_EXCL) && !e.created) throw fail('EEXIST', path);
    const fd = nextFd++;
    if (e.kind === 'dir') { fds.set(fd, { path, dir: true }); return fd; }
    if (e.mount === 'game') {
      if (write) throw fail('EACCES', path + ' (the game folder is read-only)');
      fds.set(fd, e.url ? { path, url: e.url, size: e.size, pos: 0 } : { path, file: e.obj ?? await e.handle.getFile(), pos: 0 });
      return fd;
    }
    while (opening.has(path)) await opening.get(path).catch(() => null);   // (one writer per file: a second open waits for the first)
    if (write || writers.has(path)) {
      let sync = writers.get(path);
      if (!sync) {
        // (the projects folder: always buffered, as a folder on disk has no sync access handles; also when a test
        // mounts a private-storage folder there)
        const make = (async () => e.mount !== 'projects' && e.handle.createSyncAccessHandle
          ? await e.handle.createSyncAccessHandle().catch(x => { throw errOf(x); })
          : await bufferedWriter(e.handle, !!(flags & C.O_TRUNC)))();
        opening.set(path, make);
        try { sync = await make; } finally { opening.delete(path); }
        sync.refs = 0;
        writers.set(path, sync);
      }
      sync.refs++;
      if (flags & C.O_TRUNC) sync.truncate(0);
      fds.set(fd, { path, sync, pos: 0, append: !!(flags & C.O_APPEND) });
      return fd;
    }
    fds.set(fd, { path, file: await e.handle.getFile(), pos: 0 });
    return fd;
  }

  // block cache of the install's files: 1 MiB aligned blocks, the most recently used kept up to CACHE bytes
  const BLOCK = 1 << 20, CACHE = 512 << 20;
  const opening = new Map();  // path -> the Promise of its writer being created (open)
  const blocks = new Map();   // 'path#index' -> {p: Promise<Uint8Array>, size} (Map order = least recently used first)
  let cached = 0;
  function block(f, bi, size) {
    const key = f.path + '#' + bi;
    let e = blocks.get(key);
    if (e) { blocks.delete(key); blocks.set(key, e); return e.p; }
    const start = bi * BLOCK, end = Math.min(start + BLOCK, size);
    e = { size: 0, p: (async () => {
      if (f.file) return new Uint8Array(await f.file.slice(start, end).arrayBuffer());
      stats.http++;
      const r = await fetch(f.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
      if (!r.ok) throw fail('EIO', `${f.url}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer()).subarray(0, end - start);
    })() };
    blocks.set(key, e);
    e.p.then(b => {
      e.size = b.length; cached += b.length;
      for (const [k, x] of blocks) {   // the oldest loaded blocks go first
        if (cached <= CACHE) break;
        if (!x.size || x === e) continue;
        blocks.delete(k); cached -= x.size;
      }
    }, () => blocks.delete(key));
    return e.p;
  }
  const stats = { reads: 0, bytes: 0, ms: 0, http: 0 };
  setInterval(() => { if (stats.reads) { console.log(`gofs: ${stats.reads} reads, ${(stats.bytes / 1e6).toFixed(1)} MB, ${stats.ms.toFixed(0)} ms waiting, ${stats.http} http`); stats.reads = stats.bytes = stats.ms = stats.http = 0; } }, 5000);
  async function read(fd, buf, off, len, pos) {
    const t0 = performance.now();
    try { const n = await read1(fd, buf, off, len, pos); stats.reads++; stats.bytes += n; return n; }
    finally { stats.ms += performance.now() - t0; }
  }
  async function read1(fd, buf, off, len, pos) {
    const f = fds.get(fd);
    if (!f || f.dir) throw fail('EBADF', String(fd));
    const at = pos ?? f.pos;
    let n = 0;
    if (f.sync) {
      n = f.sync.read(buf.subarray(off, off + len), { at });
    } else if (f.path.startsWith('/game/')) {
      // the install: through the block cache (the game reads many small pieces, often the same ones again)
      const size = f.file ? f.file.size : f.size, end = Math.min(at + len, size);
      for (let p = at; p < end;) {
        const bi = Math.floor(p / BLOCK), b = await block(f, bi, size);
        const from = p - bi * BLOCK, take = Math.min(end - p, b.length - from);
        buf.set(b.subarray(from, from + take), off + (p - at));
        p += take; n += take;
        if (take <= 0) break;
      }
    } else {
      const end = Math.min(at + len, f.file.size);
      if (end > at) {
        const b = new Uint8Array(await f.file.slice(at, end).arrayBuffer());
        buf.set(b, off); n = b.length;
      }
    }
    if (pos == null) f.pos = at + n;
    return n;
  }

  function writeOut(fd, buf) {
    out[fd] += new TextDecoder().decode(buf);
    const lines = out[fd].split('\n');
    out[fd] = lines.pop();
    for (const l of lines) (fd === 2 ? console.warn : console.log)(l);
    return buf.length;
  }
  async function write(fd, buf, off, len, pos) {
    if (fd === 1 || fd === 2) return writeOut(fd, buf.subarray(off, off + len));
    const f = fds.get(fd);
    if (!f || !f.sync) throw fail('EBADF', String(fd));
    const at = f.append ? f.sync.getSize() : (pos ?? f.pos);
    const n = f.sync.write(buf.subarray(off, off + len), { at });
    if (pos == null) f.pos = at + n;
    return n;
  }

  async function close(fd) {
    const f = fds.get(fd);
    if (!f) throw fail('EBADF', String(fd));
    fds.delete(fd);
    if (f.sync) {
      try { await f.sync.flush(); }
      finally {   // (a failed flush still lets go of the file)
        if (--f.sync.refs === 0) { writers.delete(f.path); try { await f.sync.close(); } catch { } }
      }
    }
  }

  async function readdir(path) {
    const e = await lookup(path);
    if (e.kind !== 'dir') throw fail('ENOTDIR', path);
    if (e.mount === 'root') return [game ? 'game' : null, home ? 'home' : null].filter(Boolean);
    if (e.mount === 'game' && game.files) return [...(game.dirs.get(e.key) ?? [])];
    const names = [];
    for await (const name of e.handle.keys()) names.push(name);
    return names.sort();
  }

  async function mkdir(path) {
    try { await lookup(path); throw fail('EEXIST', path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const { dir, name } = await parentOf(path);
    await dir.getDirectoryHandle(name, { create: true }).catch(x => { throw errOf(x); });
  }
  async function remove(path, wantDir) {
    const e = await lookup(path);
    if (wantDir && e.kind !== 'dir') throw fail('ENOTDIR', path);
    if (!wantDir && e.kind === 'dir') throw fail('EISDIR', path);
    if (writers.has(norm(path))) throw fail('EBUSY', path);
    const { dir, name } = await parentOf(path);
    await dir.removeEntry(name).catch(x => { throw errOf(x); });
  }
  // private: the destination is in the browser's private storage (sync access handles); else a folder on disk
  async function copyTree(src, dstDir, name, priv = true) {
    if (src.kind === 'file') {
      const data = await (await src.getFile()).arrayBuffer();
      const h = await dstDir.getFileHandle(name, { create: true });
      if (!priv || !h.createSyncAccessHandle) { const w = await h.createWritable(); await w.write(data); await w.close(); return; }
      const w = await h.createSyncAccessHandle();
      try { w.truncate(0); w.write(new Uint8Array(data), { at: 0 }); w.flush(); } finally { w.close(); }
      return;
    }
    const d = await dstDir.getDirectoryHandle(name, { create: true });
    for await (const [n, h] of src.entries()) await copyTree(h, d, n, priv);
  }
  async function rename(from, to) {
    if (norm(from) === norm(to)) { await lookup(from); return; }   // (onto itself: nothing to do; never removes the source)
    const e = await lookup(from);
    if (e.mount !== 'home' && e.mount !== 'projects') throw fail('EACCES', from);   // (the game folder is read-only)
    if (writers.has(norm(from))) throw fail('EBUSY', from);
    const dst = await parentOf(to);
    // the target is replaced (POSIX rename): a file moved aside first (put back if the move fails: never neither
    // file); a folder only when empty (ENOTEMPTY otherwise); a file onto a folder or a folder onto a file refused
    let aside = null;
    try {
      const t = await lookup(to);
      if (t.kind === 'dir' && e.kind !== 'dir') throw fail('EISDIR', to);
      if (t.kind !== 'dir' && e.kind === 'dir') throw fail('ENOTDIR', to);
      if (t.kind === 'dir') {
        for await (const _ of t.handle.keys()) throw fail('ENOTEMPTY', to);
        await dst.dir.removeEntry(dst.name);
      } else {
        aside = '.' + dst.name + '.old-' + Date.now().toString(36);
        if (t.handle.move) await t.handle.move(dst.dir, aside).catch(x => { throw errOf(x); });
        else { await copyTree(t.handle, dst.dir, aside, segs(to)[0] !== 'projects'); await dst.dir.removeEntry(dst.name); }
      }
    } catch (x) { if (x.code !== 'ENOENT') throw x; }
    try {
      if (e.kind === 'file' && e.handle.move) await e.handle.move(dst.dir, dst.name).catch(x => { throw errOf(x); });
      else {
        await copyTree(e.handle, dst.dir, dst.name, segs(to)[0] !== 'projects');
        await e.parent.removeEntry(e.name, { recursive: true });
      }
    } catch (x) {
      if (aside) {   // (the old one back where it was)
        const a = await dst.dir.getFileHandle(aside).catch(() => null);
        if (a?.move) await a.move(dst.dir, dst.name).catch(() => { });
      }
      throw x;
    }
    if (aside) await dst.dir.removeEntry(aside).catch(() => { });
  }
  async function truncate(path, len) {
    const fd = await open(path, C.O_WRONLY, 0);
    try { fds.get(fd).sync.truncate(len); } finally { await close(fd); }
  }

  // node-style: the last argument is the callback (err, value)
  const cb = f => (...args) => {
    const done = args.pop();
    f(...args).then(v => done(null, v), e => done(errOf(e)));
  };
  const ok = (...args) => args.pop()(null);
  const nosys = (...args) => args.pop()(fail('ENOSYS', 'not supported'));

  globalThis.fs = {
    constants: C,
    writeSync(fd, buf) { return fd === 1 || fd === 2 ? writeOut(fd, buf) : 0; },
    open: cb(open), close: cb(close), read: cb(read), write: cb(write),
    fstat: cb(async fd => {
      const f = fds.get(fd);
      if (!f) throw fail('EBADF', String(fd));
      if (f.dir) return statOf('dir', 0);
      if (f.sync) return statOf('file', f.sync.getSize());
      if (f.file) return statOf('file', f.file.size, f.file.lastModified);
      return statOf('file', f.size, 0);
    }),
    stat: cb(stat), lstat: cb(stat), readdir: cb(readdir), mkdir: cb(mkdir),
    rmdir: cb(p => remove(p, true)), unlink: cb(p => remove(p, false)), rename: cb(rename),
    truncate: cb(truncate),
    ftruncate: cb(async (fd, len) => { const f = fds.get(fd); if (!f?.sync) throw fail('EBADF', String(fd)); f.sync.truncate(len); }),
    fsync: cb(async fd => { await fds.get(fd)?.sync?.flush(); }),
    chmod: ok, fchmod: ok, chown: ok, fchown: ok, lchown: ok, utimes: ok,
    readlink: nosys, symlink: nosys, link: nosys,
  };
  globalThis.process ??= { getuid: () => -1, getgid: () => -1, geteuid: () => -1, getegid: () => -1,
    getgroups() { throw fail('ENOSYS'); }, pid: -1, ppid: -1, umask: () => 0o22, cwd: () => '/', chdir() { throw fail('ENOSYS'); } };

  globalThis.gofs = {
    // /home: the browser's private storage
    async init() { home = await navigator.storage.getDirectory(); },
    // /projects: the projects folder on disk the user chose (Chrome / Edge), or null; copy: browser-storage projects
    // (in /home/Documents/LUT Studio) not in the folder yet are copied into it
    async mountProjects(h, copy) {
      projects = h;
      if (!h || !copy) return 0;
      let n = 0;
      try {
        const src = (await lookup('/home/Documents/LUT Studio')).handle;
        for await (const [name, sub] of src.entries()) {
          if (sub.kind !== 'directory') continue;
          try { await h.getDirectoryHandle(name); continue; } catch { }
          await copyTree(sub, h, name, false); n++;   // (into the folder on disk)
        }
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return n;
    },
    // /game: the files of the folder chosen with a file input, {files: [[path, File]]}; or (tests) a folder served
    // over HTTP, {base, files: [[path, size]]}
    async mountGame(src) {
      blocks.clear(); cached = 0;   // (another or updated game folder: no blocks of the old one)
      if (src?.files) {
        const objs = src.base ? null : new Map(src.files);
        const files = objs ? new Map([...objs].map(([p, f]) => [p, f.size])) : new Map(src.files), dirs = new Map([['', new Set()]]);
        for (const p of files.keys()) {
          const s = p.split('/');
          for (let i = 0; i < s.length; i++) {
            const d = s.slice(0, i).join('/');
            if (!dirs.has(d)) dirs.set(d, new Set());
            dirs.get(d).add(s[i]);
            if (i < s.length - 1 && !dirs.has(s.slice(0, i + 1).join('/'))) dirs.set(s.slice(0, i + 1).join('/'), new Set());
          }
        }
        game = { base: src.base ? (src.base.endsWith('/') ? src.base : src.base + '/') : '', files, objs, dirs };
        return;
      }
      throw fail('EINVAL', 'no game files');
    },
  };
})();
