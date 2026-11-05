package version

import "testing"

func TestCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"2.9.6", "3.0.0", -1},
		{"3.0.0", "3.0.0", 0},
		{"v3.0.0", "3.0.0", 0},
		{"3.0.0-beta.1", "3.0.0", -1},
		{"3.0.0", "3.0.0-beta.2", 1},
		{"3.0.0-beta.10", "3.0.0-beta.2", 1},
		{"3.0.0-rc.1", "3.0.0-beta.9", 1},
		{"3.0.1", "3.0.0", 1},
		{"10.0.0", "9.9.9", 1},
		{"мусор", "3.0.0", -1},
	}
	for _, c := range cases {
		if got := Compare(c.a, c.b); got != c.want {
			t.Fatalf("Compare(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestAtLeast(t *testing.T) {
	if !AtLeast("3.0.0", "3.0.0-beta.1") {
		t.Fatal("финальный 3.0.0 должен проходить минимальную бета-версию")
	}
	if AtLeast("2.9.6", "3.0.0-beta.1") {
		t.Fatal("2.9.6 не должен проходить")
	}
	if AtLeast("", "3.0.0-beta.1") {
		t.Fatal("пустая версия не должна проходить")
	}
}
