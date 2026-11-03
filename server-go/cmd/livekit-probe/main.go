package main

import (
	"fmt"
	"os"

	"sozvon/server/internal/livekit"
)

func main() {
	opts := livekit.Options{URL: os.Getenv("LIVEKIT_URL"), APIURL: os.Getenv("LIVEKIT_API_URL"), Key: os.Getenv("LIVEKIT_API_KEY"), Secret: os.Getenv("LIVEKIT_API_SECRET")}
	status, err := opts.ListRooms()
	if err != nil {
		fmt.Println("ERR", err.Error())
		os.Exit(1)
	}
	fmt.Println("STATUS", status)
}
