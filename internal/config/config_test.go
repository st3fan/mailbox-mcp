package config

import (
	"os"
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	tests := []struct {
		name     string
		env      map[string]string
		want     Config
		wantErr  bool
		errParts []string
	}{
		{
			name: "valid config with defaults",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "mail.example.com",
				EnvMessagesAPIURL:     "https://messages.example.com",
				EnvMessagesAPIToken:   "mtoken123",
			},
			want: Config{
				CloudflareAPIToken: "token123",
				Domain:             "mail.example.com",
				EmailWorker:        DefaultEmailWorker,
				Transport:          DefaultTransport,
				MessagesAPIURL:     "https://messages.example.com",
				MessagesAPIToken:   "mtoken123",
			},
		},
		{
			name: "valid config with overrides",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "mail.example.com",
				EnvEmailWorker:        "my-worker",
				EnvTransport:          TransportStdio,
				EnvMessagesAPIURL:     "https://messages.example.com",
				EnvMessagesAPIToken:   "mtoken123",
			},
			want: Config{
				CloudflareAPIToken: "token123",
				Domain:             "mail.example.com",
				EmailWorker:        "my-worker",
				Transport:          TransportStdio,
				MessagesAPIURL:     "https://messages.example.com",
				MessagesAPIToken:   "mtoken123",
			},
		},
		{
			name:     "missing api token",
			env:      map[string]string{EnvDomain: "mail.example.com"},
			wantErr:  true,
			errParts: []string{EnvCloudflareAPIToken},
		},
		{
			name:     "missing domain",
			env:      map[string]string{EnvCloudflareAPIToken: "token123"},
			wantErr:  true,
			errParts: []string{EnvDomain},
		},
		{
			name:     "missing messages api config",
			env:      map[string]string{EnvCloudflareAPIToken: "token123", EnvDomain: "mail.example.com"},
			wantErr:  true,
			errParts: []string{EnvMessagesAPIURL, EnvMessagesAPIToken, "are required"},
		},
		{
			name:     "all required config missing reports every problem",
			env:      map[string]string{},
			wantErr:  true,
			errParts: []string{EnvCloudflareAPIToken, EnvDomain, EnvMessagesAPIURL, EnvMessagesAPIToken},
		},
		{
			name: "invalid domain",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "not a domain",
			},
			wantErr:  true,
			errParts: []string{EnvDomain, "not a valid domain name"},
		},
		{
			name: "single label domain is invalid",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "localhost",
			},
			wantErr:  true,
			errParts: []string{EnvDomain, "at least two labels"},
		},
		{
			name: "unknown transport",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "mail.example.com",
				EnvTransport:          "http",
			},
			wantErr:  true,
			errParts: []string{EnvTransport, "unknown transport"},
		},
		{
			name: "surrounding whitespace is trimmed",
			env: map[string]string{
				EnvCloudflareAPIToken: " token123 ",
				EnvDomain:             " mail.example.com ",
				EnvMessagesAPIURL:     " https://messages.example.com ",
				EnvMessagesAPIToken:   " mtoken123 ",
			},
			want: Config{
				CloudflareAPIToken: "token123",
				Domain:             "mail.example.com",
				EmailWorker:        DefaultEmailWorker,
				Transport:          DefaultTransport,
				MessagesAPIURL:     "https://messages.example.com",
				MessagesAPIToken:   "mtoken123",
			},
		},
		{
			name: "messages api configured",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "mail.example.com",
				EnvMessagesAPIURL:     "https://messages.example.com",
				EnvMessagesAPIToken:   "mtoken123",
			},
			want: Config{
				CloudflareAPIToken: "token123",
				Domain:             "mail.example.com",
				EmailWorker:        DefaultEmailWorker,
				Transport:          DefaultTransport,
				MessagesAPIURL:     "https://messages.example.com",
				MessagesAPIToken:   "mtoken123",
			},
		},
		{
			name: "messages api url without token",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "mail.example.com",
				EnvMessagesAPIURL:     "https://messages.example.com",
			},
			wantErr:  true,
			errParts: []string{EnvMessagesAPIURL, EnvMessagesAPIToken, "are required"},
		},
		{
			name: "messages api token without url",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "mail.example.com",
				EnvMessagesAPIToken:   "mtoken123",
			},
			wantErr:  true,
			errParts: []string{EnvMessagesAPIURL, EnvMessagesAPIToken, "are required"},
		},
		{
			name: "messages api url with a bad scheme",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "mail.example.com",
				EnvMessagesAPIURL:     "ftp://messages.example.com",
				EnvMessagesAPIToken:   "mtoken123",
			},
			wantErr:  true,
			errParts: []string{EnvMessagesAPIURL, "http or https"},
		},
		{
			name: "messages api url without a host",
			env: map[string]string{
				EnvCloudflareAPIToken: "token123",
				EnvDomain:             "mail.example.com",
				EnvMessagesAPIURL:     "https://",
				EnvMessagesAPIToken:   "mtoken123",
			},
			wantErr:  true,
			errParts: []string{EnvMessagesAPIURL, "missing host"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for k, v := range tt.env {
				t.Setenv(k, v)
			}

			got, err := Load()

			if tt.wantErr {
				if err == nil {
					t.Fatalf("Load() = %+v, want error", got)
				}
				for _, part := range tt.errParts {
					if !strings.Contains(err.Error(), part) {
						t.Errorf("Load() error = %q, want it to contain %q", err.Error(), part)
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("Load() error = %v, want nil", err)
			}
			if got != tt.want {
				t.Errorf("Load() = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestLoadUnsetEnv(t *testing.T) {
	// Without t.Setenv, make sure the defaults apply when nothing is set.
	got, err := Load()
	if err == nil {
		t.Fatalf("Load() = %+v, want error for missing required config", got)
	}
}

func TestLoadDotenv(t *testing.T) {
	t.Chdir(t.TempDir())
	content := strings.Join([]string{
		"# a comment",
		"",
		"export MAILBOX_MCP_CLOUDFLARE_API_TOKEN=\"token123\"",
		"MAILBOX_MCP_DOMAIN = mail.example.com",
		"MAILBOX_MCP_MESSAGES_API_URL='https://messages.example.com'",
		"MAILBOX_MCP_MESSAGES_API_TOKEN=mtoken123",
		"UNKNOWN_KEY=ignored",
		"a line without an equals sign",
	}, "\n")
	if err := os.WriteFile(".env", []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	want := Config{
		CloudflareAPIToken: "token123",
		Domain:             "mail.example.com",
		EmailWorker:        DefaultEmailWorker,
		Transport:          DefaultTransport,
		MessagesAPIURL:     "https://messages.example.com",
		MessagesAPIToken:   "mtoken123",
	}
	if got != want {
		t.Errorf("Load() = %+v, want %+v", got, want)
	}
}

func TestLoadDotenvEnvironmentWins(t *testing.T) {
	t.Chdir(t.TempDir())
	content := strings.Join([]string{
		"MAILBOX_MCP_CLOUDFLARE_API_TOKEN=dotenv-token",
		"MAILBOX_MCP_DOMAIN=dotenv.example",
		"MAILBOX_MCP_MESSAGES_API_URL=https://dotenv.example",
		"MAILBOX_MCP_MESSAGES_API_TOKEN=dotenv-mtoken",
	}, "\n")
	if err := os.WriteFile(".env", []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(EnvDomain, "env.example")
	t.Setenv(EnvMessagesAPIToken, "env-mtoken")

	got, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	switch {
	case got.Domain != "env.example":
		t.Errorf("Domain = %q, want the environment to win over .env", got.Domain)
	case got.CloudflareAPIToken != "dotenv-token":
		t.Errorf("CloudflareAPIToken = %q, want the .env value", got.CloudflareAPIToken)
	case got.MessagesAPIToken != "env-mtoken":
		t.Errorf("MessagesAPIToken = %q, want the environment to win over .env", got.MessagesAPIToken)
	case got.MessagesAPIURL != "https://dotenv.example":
		t.Errorf("MessagesAPIURL = %q, want the .env value", got.MessagesAPIURL)
	}
}

func TestLoadDotenvMissingIsFine(t *testing.T) {
	t.Chdir(t.TempDir())
	_, err := Load()
	if err == nil {
		t.Fatalf("Load() error = nil, want the missing-required error")
	}
	for _, part := range []string{EnvCloudflareAPIToken, EnvDomain, EnvMessagesAPIURL, "in .env"} {
		if !strings.Contains(err.Error(), part) {
			t.Errorf("Load() error = %q, want it to contain %q", err.Error(), part)
		}
	}
}

func TestLoadDotenvUnreadableFails(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := os.WriteFile(".env", []byte("MAILBOX_MCP_DOMAIN=x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(".env", 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(".env", 0o600) })

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "read .env") {
		t.Fatalf("Load() error = %v, want an unreadable-.env error", err)
	}
}
