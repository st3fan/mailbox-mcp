package config

import (
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
