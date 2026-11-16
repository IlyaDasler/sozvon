package store

import "testing"

func TestPushTokenCanMoveBetweenAccountsAndBeRemoved(t *testing.T) {
	st := newStore(t)
	first, err := st.CreateUser("push_first", "hash", "First", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	second, err := st.CreateUser("push_second", "hash", "Second", "#12a594")
	if err != nil {
		t.Fatal(err)
	}

	if err := st.SavePushToken(first.ID, "device-token", "android"); err != nil {
		t.Fatal(err)
	}
	if err := st.SavePushToken(second.ID, "device-token", "android"); err != nil {
		t.Fatal(err)
	}
	if tokens, err := st.PushTokensForUsers([]int64{first.ID}); err != nil || len(tokens) != 0 {
		t.Fatalf("previous account retained token: %#v, %v", tokens, err)
	}
	if tokens, err := st.PushTokensForUsers([]int64{second.ID}); err != nil || len(tokens) != 1 || tokens[0] != "device-token" {
		t.Fatalf("new account token association: %#v, %v", tokens, err)
	}

	if err := st.DeletePushToken(first.ID, "device-token"); err != nil {
		t.Fatal(err)
	}
	if tokens, err := st.PushTokensForUsers([]int64{second.ID}); err != nil || len(tokens) != 1 {
		t.Fatalf("old account removed current account token: %#v, %v", tokens, err)
	}
	if err := st.DeletePushToken(second.ID, "device-token"); err != nil {
		t.Fatal(err)
	}
	if tokens, err := st.PushTokensForUsers([]int64{second.ID}); err != nil || len(tokens) != 0 {
		t.Fatalf("logout did not remove token: %#v, %v", tokens, err)
	}
}
