package server

import "testing"

// recolorDecals: alpha kept; "two": light parts take the light color, dark parts the dark one; "one": the light
// color, the artwork's shading a little
func TestRecolorDecals(t *testing.T) {
	px := []byte{255, 255, 255, 200, 0, 0, 0, 255, 128, 128, 128, 0}
	two := append([]byte(nil), px...)
	recolorDecals(two, "two", [3]float32{1, 0.5, 0}, [3]float32{0, 0, 1})
	if two[0] != 255 || two[1] != 128 || two[2] != 0 || two[3] != 200 {
		t.Errorf("white -> light: %v", two[:4])
	}
	if two[4] != 0 || two[5] != 0 || two[6] != 255 || two[7] != 255 {
		t.Errorf("black -> dark: %v", two[4:8])
	}
	if two[11] != 0 {
		t.Errorf("alpha changed: %d", two[11])
	}
	one := append([]byte(nil), px...)
	recolorDecals(one, "one", [3]float32{0.8, 0.8, 0.8}, [3]float32{})
	if !(one[0] > one[4] && one[4] > 0 && one[3] == 200) {
		t.Errorf("one color, shading kept: %v", one)
	}
}
