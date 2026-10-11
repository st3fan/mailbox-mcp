package server

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/st3fan/mailbox-mcp/internal/config"
)

// testConfig is a full configuration for newServer. Building the server never
// touches the network, so fake values are fine; the messages API URL points
// at a port with no listener, which would only matter if a tool actually
// called it — no test here does.
func testConfig() config.Config {
	return config.Config{
		CloudflareAPIToken: "test-token",
		Domain:             "example.com",
		EmailWorker:        config.DefaultEmailWorker,
		Transport:          config.TransportHTTP,
		HTTPAddr:           "127.0.0.1:0",
		MessagesAPIURL:     "http://127.0.0.1:9",
		MessagesAPIToken:   "test-mtoken",
	}
}

func TestHTTPTransportServesMCP(t *testing.T) {
	srv := newServer(testConfig(), "zone-1")

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })
	done := make(chan error, 1)
	go func() { done <- serveHTTPOn(ln, srv) }()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint: "http://" + ln.Addr().String() + "/mcp",
	}, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer session.Close()

	init := session.InitializeResult()
	if init == nil || init.ServerInfo.Name != "mailbox-mcp" {
		t.Fatalf("server info = %+v, want mailbox-mcp", init)
	}
	if init.Instructions == "" {
		t.Error("instructions are empty, want the agent guidance")
	}

	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	// 6 mailbox tools + 5 message tools.
	if len(tools.Tools) != 11 {
		t.Errorf("tools = %d, want 11", len(tools.Tools))
	}

	prompts, err := session.ListPrompts(ctx, nil)
	if err != nil {
		t.Fatalf("list prompts: %v", err)
	}
	if len(prompts.Prompts) != 3 {
		t.Errorf("prompts = %d, want 3", len(prompts.Prompts))
	}

	// A prompt get exercises the full round trip without touching the
	// network: the handler is local.
	prompt, err := session.GetPrompt(ctx, &mcp.GetPromptParams{
		Name:      "mailbox-summary",
		Arguments: map[string]string{"address": "alice@example.com"},
	})
	if err != nil {
		t.Fatalf("get prompt: %v", err)
	}
	if len(prompt.Messages) != 1 {
		t.Fatalf("prompt messages = %d, want 1", len(prompt.Messages))
	}
}

func TestServeHTTPBadAddr(t *testing.T) {
	// serveHTTP surfaces listen errors instead of panicking.
	err := serveHTTP(newServer(testConfig(), "zone-1"), "not-an-address")
	if err == nil {
		t.Fatal("serveHTTP error = nil, want a listen error")
	}
}
