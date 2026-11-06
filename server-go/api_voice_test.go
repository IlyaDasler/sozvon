package main

import (
	"testing"
)

func TestVoiceParticipantsStableOrder(t *testing.T) {
	v := newVoiceManager()
	// Разный joinedAt и разный порядок в map: список должен идти по времени входа.
	v.rooms[7] = &voiceRoom{media: "p2p", startedAt: 1, parts: map[int64]*voiceParticipant{
		30: {joinedAt: 3000},
		10: {joinedAt: 1000},
		20: {joinedAt: 2000},
	}}
	got := v.participants(7)
	if len(got) != 3 {
		t.Fatalf("участников %d, ждали 3", len(got))
	}
	want := []int64{10, 20, 30}
	for i, id := range want {
		if got[i]["userId"] != id {
			t.Fatalf("порядок: got %v, want %v", []any{got[0]["userId"], got[1]["userId"], got[2]["userId"]}, want)
		}
	}
}

func TestVoiceParticipantsEmpty(t *testing.T) {
	v := newVoiceManager()
	if len(v.participants(1)) != 0 {
		t.Fatal("в пустой комнате не должно быть участников")
	}
}
