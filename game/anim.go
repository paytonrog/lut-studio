package game

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"github.com/go-gl/mathgl/mgl32"
	extr_animation "github.com/xypwn/filediver/extractor/animation"
	"github.com/xypwn/filediver/stingray"
	"github.com/xypwn/filediver/stingray/animation"
	"github.com/xypwn/filediver/stingray/bones"
	"github.com/xypwn/filediver/stingray/state_machine"
)

// The Helldiver avatar's animation set: its state machine names the clips, its bones resource maps an animation's
// bone index to a bone name (the node names of every armor piece's skeleton in filediver's glTF export).
var avatarName = stingray.Sum("content/fac_helldivers/cha_avatar/avatar_helldiver")

// Pose is one full-body clip the preview can play.
type Pose struct {
	Name      string `json:"name"`
	Animation string `json:"animation"`
	State     string `json:"state"`
	Loop      bool   `json:"loop"`
	Group     string `json:"group"` // the Pose menu's section: Armory, Moves, Emotes
}

// morePoses: full-body clips of the avatar's state machine whose states have no names, labeled from the events that
// lead into them and how they move (walk 1.5 m/s, jog 2.4, sprint 6; pelvis height for crouch, prone, sitting). The
// preview plays the moving ones in place (render.js prepareClip).
var morePoses = []struct{ name, anim, group string }{
	{"Stand", "0x55a8bd88c8c6422e", "Moves"},
	{"Walk", "0xce5ed97dc3c5e599", "Moves"},
	{"Jog", "0x27a248375c6d93f3", "Moves"},
	{"Sprint", "0x0f93b8bf901345ea", "Moves"},
	{"Crouch", "0x438106c6304bc67a", "Moves"},
	{"Crouch walk", "0x71400fbc83a050eb", "Moves"},
	{"Crawl", "0x6bfea7bc0e556f88", "Moves"},
	{"Downed", "0x590c50a1622300fc", "Moves"},
	{"Swim", "0xb6b16d164205e962", "Moves"},
	{"Salute", "0xe32b270524630569", "Emotes"},
	{"Sit", "0x5de336b18356ae69", "Emotes"},
	{"March", "0xf0ffb4a139775914", "Emotes"},
	{"March (flag)", "0xaf094072538cd547", "Emotes"},
	{"Taunt", "0xa4950a590f729419", "Emotes"},
	{"Chest bump (waiting)", "0x2ece6bdabb98bd0e", "Emotes"},
	{"Rock-paper-scissors (waiting)", "0xbf9271730791d843", "Emotes"},
	{"Quick draw", "0xf439ec70399a3624", "Emotes"},
	{"Hug (waiting)", "0x737c24ae2b166ea7", "Emotes"},
	{"High-Five (waiting)", "0x75205314048dcdaa", "Emotes"},
	{"Explosive Handshake (waiting)", "0xb739141450a24386", "Emotes"},
	{"Scout Handshake (waiting)", "0xc3184a16511d25af", "Emotes"},
	{"Diplomatic Handshake (waiting)", "0xc20d6ee1ba6977a6", "Emotes"},
	{"Test of Conviction (waiting)", "0x632297ae18e9b91c", "Emotes"},
	{"Natural Gas Extraction (waiting)", "0x357d0df512811a10", "Emotes"},
	{"At Ease", "0x7ae89ba50cd12d53", "Emotes"},
	{"Enthusiastic Mirth", "0x3982524e02baea81", "Emotes"},
	{"Protect Eardrums", "0x7c873d6a0bafbf78", "Emotes"},
	{"Solicit Transportation", "0x6029e95b4fe4c0c3", "Emotes"},
	{"Trucker's Triumph", "0xa3c10197459b5e20", "Emotes"},       // one-shot, closure 1.8 deg
	{"Helmet Durability Check", "0xaf4ae9075821a318", "Emotes"}, // one-shot, closure 0.2 deg
}

// The in-game names of the clips (the game's emote and armory pose tables: each entry's preview event, the state it
// enters, its name; armory poses named after the armor set they're shown with), by animation hash. Clips without
// one keep their numbered label.
var poseNames = map[string]string{
	// renamed morePoses
	"0xe32b270524630569": "Casual Salute",
	"0xf0ffb4a139775914": "Lockstep",
	"0xaf094072538cd547": "Lockstep (flag)",
	"0xa4950a590f729419": "Display of Brawn",
	"0x2ece6bdabb98bd0e": "Thoracic Collision Exultation Maneuver (waiting)",
	"0xbf9271730791d843": "Rock Paper Scissors (waiting)",
	"0xf439ec70399a3624": "Draw!",
	// one-shot emotes (L8/200-236)
	"0xd3a69dc79d2fee76": "Boxer 1", "0xe1b983920c8c40ba": "Boxer 2", "0xad7c5feac64332b7": "Boxer 3",
	"0x932294c9532ed089": "Big Whoop",
	"0x459e18f051165f47": "Clapping",
	"0x03bf3964bfa1fd6d": "Dab",
	"0xbc2ddd3209ad83ae": "Finger Guns",
	"0xf4402d9d4237f7eb": "Flex",
	"0x26f53e1e8009e67c": "Heel Kick",
	"0xf63b3d2143624657": "Loosen Up",
	"0x1dae1e66f2908734": "Roll 'Em",
	"0x576f6f681dd364f0": "Salute",
	"0xde7bad5fc790dec5": "Shotgun Show",
	"0x823541bc5debde11": "Target Sighted",
	"0x0c5265c6ae66b001": "Thumb of Approval",
	"0x4cfd791f5423500b": "This Guy",
	"0x5cf75686d11cddf9": "Vigorous Thrusting",
	"0xb0ae9dba4d336bca": "Mime Instrumentation",
	"0xc259ccabaf3572a2": "Call the Helldivers",
	"0x2173496aaee8ed6e": "Courtly Bow 1", "0x4fba808ec5734d1a": "Courtly Bow 2",
	"0xb15f5711026cf0c4": "Curtsy 1", "0x1f46efce0d275e7f": "Curtsy 2", "0x58a1d73d6d882f8a": "Curtsy 3",
	"0xaa2acb249d4ac07f": "Welcome Adoration",
	"0x98e7000b43c11df8": "Guns of Liberty",
	"0x1524c2a799379799": "Distribute Ballots",
	"0xd1d9d02b69d89ca6": "Presentable 1", "0x99a071fd8409eb55": "Presentable 2",
	"0x972aa1979477e850": "Squat 1", "0x226eec12967e895c": "Squat 2", "0x29cf8166b2be6615": "Squat 3",
	"0xf93adb23531ddcfc": "Squat 4", "0x009b70776f5b97a4": "Squat 5",
	"0x169f4cceb8fc038b": "Ew",
	"0x503803ea82c0dc2d": "Big Stretch",
	"0x338395fad5dbc924": "Super Person 1", "0x34b6c030581e915f": "Super Person 2",
	"0xcaa497111ffaf3e4": "Super Person 3", "0xc8aaaf3c8c727769": "Super Person 4",
	"0x86af822b70d9bb3f": "Deep Reflection",
	"0x577055ea9db1355b": "Treasure Hunt 1", "0x278a8ac23107dabb": "Treasure Hunt 2",
	"0xc1905be790035008": "Head Tap 1", "0x1aff331c2a19a069": "Head Tap 2", "0x99d5d59ae57dec6d": "Head Tap 3",
	"0x81081a1de4b4b983": "You're Next 1", "0x82843f617c8b8cd4": "You're Next 2", "0xc40ae88b504d8852": "You're Next 3",
	"0x67d5bffc0db90aeb": "Impatient 1", "0xa1c6800b0e7bfc4e": "Impatient 2", "0x5837c765199a7519": "Impatient 3",
	"0x2123611658518396": "Front-leaning rest position",
	// armory poses (layer 7), named after the armor set they come with
	"0x0b08cc58ca05ae43": "BP-20 Correct Officer pose",
	"0x666a19da26066beb": "UF-16 Inspector pose",
	"0xd2343d27507f9367": "CE-07 Demolition Specialist pose",
	"0xa9491fd5858ef517": "RS-89 Shadow Paragon pose",
	"0x1cb3fa7886dc19fe": "A-9 Helljumper pose",
	"0x0a0a6b292dd6dc37": "CW-22 Kodiak pose",
	"0xe3f3bd0bbb8c0d6d": "GS-17 Frontier Marshal pose",
	"0xf509d2ea8826a8a7": "SR-18 Roadblock pose",
	"0x156d884f3cf9794c": "AF-50 Noxious Ranger pose",
	"0x596e47c853942e44": "SA-12 Servo-Assisted pose",
	"0x9fd6b3065d1f4d7e": "KDM-763 Pacesetter pose",
	"0x2fbce958e1f556de": "DS-42 Federation's Blade pose",
	"0x36a163caf3584c46": "RE-2310 Honorary Guard pose",
	"0x4c5c900cc5fb26ca": "PH-9 Predator pose",
	"0x172af334f18ecac0": "SA-8 Ram pose",
	"0x077f9491ef35b1d2": "BFM-220 Ironclad pose",
	"0x16c1abba2e0d147d": "CPG-48 Sapper pose",
	"0xa966ba2c049e3bec": "RS-20 Constrictor pose",
	"0xbb113b9e33514a11": "EX-03 Prototype 3 pose",
	"0xb8307929c62fc1f2": "AD-26 Bleeding Edge pose",
	"0x921600f81f90f2cd": "O-2 Heavy Operator pose",
	"0xe88ed095aacc4004": "AC-1 Dutiful pose",
	"0xed0bc63ae3bdc2b7": "IE-12 Righteous pose",
	"0x5002a8fb5eed013a": "I-102 Draconaught pose",
	"0xa332d9e81cbae457": "TG-8 Sharpshooter pose", // warbond_pose_driver
}

// Poses lists the armory clips of the avatar's state machine (states armory_idle, armory_variation,
// warbond_pose_driver: full-body, not additive).
func (a *Assets) Poses() ([]Pose, error) {
	ap, err := a.openApp()
	if err != nil {
		return nil, err
	}
	b, err := a.g.data.Read(stingray.NewFileID(avatarName, stingray.Sum("state_machine")), stingray.DataMain)
	if err != nil {
		return nil, fmt.Errorf("avatar state machine: %w", err)
	}
	sm, err := state_machine.LoadStateMachine(bytes.NewReader(b))
	if err != nil {
		return nil, fmt.Errorf("avatar state machine: %w", err)
	}
	var out []Pose
	seen := map[stingray.Hash]bool{}
	for _, layer := range sm.Layers {
		for _, st := range layer.States {
			name := ap.LookupHash(st.Name)
			short := name[strings.LastIndexByte(name, '/')+1:]
			if st.Additive || !(strings.Contains(short, "armory") || strings.Contains(short, "warbond")) {
				continue
			}
			for i, h := range st.AnimationHashes {
				if seen[h] {
					continue
				}
				seen[h] = true
				label := pretty(short)
				if len(st.AnimationHashes) > 1 {
					label = fmt.Sprintf("%s %d", label, i+1)
				}
				out = append(out, Pose{Name: label, Animation: fmt.Sprintf("0x%016x", h.Value), State: name, Loop: st.Loop, Group: "Armory"})
			}
		}
	}
	// the other armory / warbond poses (layer 7's unnamed clip states) and the one-shot emotes (layer 8's unnamed
	// states 200-236): full body, not additive
	extra := func(layer, from, to int, label, group string) {
		if layer >= len(sm.Layers) {
			return
		}
		n := 0
		for i, st := range sm.Layers[layer].States {
			if i < from || i > to || st.Additive || len(st.AnimationHashes) == 0 || !strings.HasPrefix(ap.LookupHash(st.Name), "0x") {
				continue
			}
			for _, h := range st.AnimationHashes {
				if seen[h] {
					continue
				}
				seen[h] = true
				n++
				out = append(out, Pose{Name: fmt.Sprintf("%s %d", label, n), Animation: fmt.Sprintf("0x%016x", h.Value), Loop: st.Loop, Group: group})
			}
		}
	}
	extra(7, 5, 31, "Armory pose", "Armory")
	for _, m := range morePoses {
		if h, ok := parseHex(m.anim); ok && !seen[stingray.Hash{Value: h}] {
			seen[stingray.Hash{Value: h}] = true
			out = append(out, Pose{Name: m.name, Animation: m.anim, Loop: true, Group: m.group})
		}
	}
	extra(8, 200, 236, "Emote", "Emotes")
	for i := range out {
		if n, ok := poseNames[out[i].Animation]; ok {
			out[i].Name = n
		}
	}
	// the emotes by name, the numbered ones (no in-game name) after, in the emotes' places in the list
	var at []int
	var em []Pose
	for i, p := range out {
		if p.Group == "Emotes" {
			at, em = append(at, i), append(em, p)
		}
	}
	sort.SliceStable(em, func(i, j int) bool {
		an, bn := strings.HasPrefix(em[i].Name, "Emote "), strings.HasPrefix(em[j].Name, "Emote ")
		if an != bn {
			return bn
		}
		return !an && strings.ToLower(em[i].Name) < strings.ToLower(em[j].Name)
	})
	for k, i := range at {
		out[i] = em[k]
	}
	return out, nil
}

// "armory_idle" -> "Armory idle", "warbond_pose_driver" -> "Warbond pose".
func pretty(s string) string {
	s = strings.TrimSuffix(s, "_driver")
	s = strings.ReplaceAll(s, "_", " ")
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// Track is one bone's sampled curves (times in seconds; translation xyz, rotation quaternion xyzw, scale xyz).
type Track struct {
	Bone     string       `json:"bone"`
	Additive bool         `json:"additive,omitempty"`
	PT       []float32    `json:"pt"`
	P        [][3]float32 `json:"p"`
	RT       []float32    `json:"rt"`
	R        [][4]float32 `json:"r"`
	ST       []float32    `json:"st"`
	S        [][3]float32 `json:"s"`
}

type Clip struct {
	Animation string  `json:"animation"`
	Length    float32 `json:"length"`
	Tracks    []Track `json:"tracks"`
}

// AnimationJSON decodes an avatar animation with filediver's reader and samples every bone's curves at 30 fps (its
// Hermite sampling, as its glTF export with sampled animations), cached as JSON. The root bone's channel gets the
// same -90° X conversion filediver applies to the exported skeleton (extractor/animation/extractor.go).
func (a *Assets) AnimationJSON(h uint64) ([]byte, error) {
	file := filepath.Join(a.cache, "anim-2", fmt.Sprintf("%016x.json", h)) // (-2: rotation keys hemisphere-aligned)
	if b, err := os.ReadFile(file); err == nil {
		return b, nil
	}
	bb, err := a.g.data.Read(stingray.NewFileID(avatarName, stingray.Sum("bones")), stingray.DataMain)
	if err != nil {
		return nil, fmt.Errorf("avatar bones: %w", err)
	}
	info, err := bones.LoadBones(bytes.NewReader(bb))
	if err != nil {
		return nil, fmt.Errorf("avatar bones: %w", err)
	}
	ab, err := a.g.data.Read(stingray.NewFileID(stingray.Hash{Value: h}, stingray.Sum("animation")), stingray.DataMain)
	if err != nil {
		return nil, fmt.Errorf("animation %016x: %w", h, err)
	}
	anim, err := animation.LoadAnimation(bytes.NewReader(ab))
	if err != nil {
		return nil, fmt.Errorf("animation %016x: %w", h, err)
	}
	n := anim.Header.BoneCount
	pos := make([]extr_animation.VectorCurve, n)
	rot := make([]extr_animation.QuaternionCurve, n)
	scl := make([]extr_animation.VectorCurve, n)
	add := make([]bool, n)
	for i, it := range anim.Header.InitialTransforms {
		d := anim.Header.AnimationLength
		pos[i] = extr_animation.VectorCurve{Duration: d, Keyframes: []extr_animation.VectorKeyframe{{Time: 0, Vector: it.Position()}}}
		rot[i] = extr_animation.QuaternionCurve{Duration: d, Keyframes: []extr_animation.QuaternionKeyframe{{Time: 0, Quaternion: it.Rotation()}}}
		scl[i] = extr_animation.VectorCurve{Duration: d, Keyframes: []extr_animation.VectorKeyframe{{Time: 0, Vector: it.Scale()}}}
		add[i] = it.IsAdditive()
	}
	for _, e := range anim.Entries {
		bi := uint32(e.Header.Bone())
		if bi >= n {
			continue
		}
		t := float32(e.Header.TimeMS()) / 1000
		kind := e.Header.Type()
		sub := kind
		if kind == animation.EntryTypeExtended {
			switch e.Header.Subtype() {
			case animation.EntrySubtypePosition:
				sub = animation.EntryTypePosition
			case animation.EntrySubtypeRotation:
				sub = animation.EntryTypeRotation
			case animation.EntrySubtypeScale:
				sub = animation.EntryTypeScale
			}
		}
		switch sub {
		case animation.EntryTypePosition:
			if v, err := e.Position(); err == nil {
				pos[bi].Keyframes = append(pos[bi].Keyframes, extr_animation.VectorKeyframe{Time: t, Vector: v})
			}
		case animation.EntryTypeRotation:
			if v, err := e.Rotation(); err == nil {
				rot[bi].Keyframes = append(rot[bi].Keyframes, extr_animation.QuaternionKeyframe{Time: t, Quaternion: v})
			}
		case animation.EntryTypeScale:
			if v, err := e.Scale(); err == nil {
				scl[bi].Keyframes = append(scl[bi].Keyframes, extr_animation.VectorKeyframe{Time: t, Vector: v})
			}
		}
	}
	// rotation keys on one hemisphere: q and -q are the same rotation, but the Hermite sampling between a key and the
	// next one stored negated swings the long way (Armory idle 1's l_foot: its 8 s key is its 4 s key negated, so the
	// foot spun ~160 deg around 6 s)
	for i := range rot {
		kf := rot[i].Keyframes
		sort.SliceStable(kf, func(a, b int) bool { return kf[a].Time < kf[b].Time })
		for k := 1; k < len(kf); k++ {
			if kf[k-1].Quaternion.Dot(kf[k].Quaternion) < 0 {
				kf[k].Quaternion = kf[k].Quaternion.Scale(-1)
			}
		}
	}
	conv := mgl32.QuatRotate(mgl32.DegToRad(-90), mgl32.Vec3{1, 0, 0})
	clip := Clip{Animation: fmt.Sprintf("0x%016x", h), Length: anim.Header.AnimationLength}
	for i := uint32(0); i < n; i++ {
		if int(i) >= len(info.Hashes) {
			break
		}
		name, ok := info.NameMap[info.Hashes[i]]
		if !ok {
			name = info.Hashes[i].String()
		}
		root := name == "StingrayEntityRoot"
		tr := Track{Bone: name, Additive: add[i]}
		for _, k := range pos[i].Sample(30) {
			v := k.Vector
			if root && !add[i] {
				v = conv.Rotate(v)
			}
			tr.PT, tr.P = append(tr.PT, k.Time), append(tr.P, [3]float32(v))
		}
		for _, k := range rot[i].Sample(30) {
			q := k.Quaternion
			if root && !add[i] {
				q = conv.Mul(q)
			}
			tr.RT, tr.R = append(tr.RT, k.Time), append(tr.R, [4]float32{q.V[0], q.V[1], q.V[2], q.W})
		}
		for _, k := range scl[i].Sample(30) {
			tr.ST, tr.S = append(tr.ST, k.Time), append(tr.S, [3]float32(k.Vector))
		}
		clip.Tracks = append(clip.Tracks, tr)
	}
	b, err := json.Marshal(clip)
	if err != nil {
		return nil, err
	}
	writeCache(file, b)
	return b, nil
}
