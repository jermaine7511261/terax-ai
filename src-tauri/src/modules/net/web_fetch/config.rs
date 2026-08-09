//! Runtime-configurable parameters for the `web_fetch` tool (ported from ).

use std::time::Duration;

use serde::{Deserialize, Serialize};

// Safety-boundary constants. Not configurable.
pub const MAX_URL_LENGTH: usize = 2_000;
pub const MAX_REDIRECTS: usize = 10;
pub const USER_AGENT_STRING: &str = "Mozilla/5.0 (compatible; yamet-agent/1.0)";

/// Runtime-configurable parameters for the `web_fetch` tool.
/// All fields are optional — `None` means "use built-in default."
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebFetchParams {
    /// Cache time-to-live in seconds. Default: 900 (15 minutes).
    pub cache_ttl_secs: Option<u64>,
    /// Maximum number of cached pages. Default: 128.
    pub max_cache_entries: Option<usize>,
    /// HTTP request timeout in seconds. Default: 60.
    pub timeout_secs: Option<u64>,
    /// Maximum response body size in bytes. Default: 10 MB.
    pub max_content_length: Option<usize>,
    /// Maximum inline markdown output length in bytes. Default: 100,000.
    pub max_markdown_length: Option<usize>,
    /// Domains the tool is allowed to fetch. All other domains are rejected
    /// before any network I/O. Defaults to `DEFAULT_ALLOWED_DOMAINS`.
    #[serde(default)]
    pub allowed_domains: Option<Vec<String>>,
    /// Optional egress proxy endpoint.
    #[serde(default)]
    pub proxy_endpoint: Option<String>,
    /// When true, allow fetches to **explicit** loopback hosts only.
    /// Default: `false` (fail closed).
    #[serde(default)]
    pub allow_local: Option<bool>,
}

impl WebFetchParams {
    pub fn cache_ttl_secs(&self) -> Duration {
        Duration::from_secs(self.cache_ttl_secs.unwrap_or(15 * 60))
    }

    pub fn max_cache_entries(&self) -> usize {
        self.max_cache_entries.unwrap_or(128)
    }

    pub fn timeout_secs(&self) -> Duration {
        Duration::from_secs(self.timeout_secs.unwrap_or(60))
    }

    pub fn max_content_length(&self) -> usize {
        self.max_content_length.unwrap_or(10 * 1024 * 1024)
    }

    pub fn max_markdown_length(&self) -> usize {
        self.max_markdown_length.unwrap_or(100_000)
    }

    pub fn allow_local(&self) -> bool {
        self.allow_local.unwrap_or(false)
    }

    pub fn allowed_domains(&self) -> Vec<String> {
        match &self.allowed_domains {
            Some(v) => v.clone(),
            None => DEFAULT_ALLOWED_DOMAINS
                .iter()
                .map(|s| (*s).to_owned())
                .collect(),
        }
    }
}

/// Default allowlist for web_fetch (ported from  DEFAULT_ALLOWED_DOMAINS).
/// GET-only preapproved developer-documentation domains.
pub static DEFAULT_ALLOWED_DOMAINS: &[&str] = &[
    // xAI
    "x.ai",
    "docs.x.ai",
    "api.x.ai",
    // Programming languages
    "docs.python.org",
    "en.cppreference.com",
    "docs.oracle.com",
    "learn.microsoft.com",
    "developer.mozilla.org",
    "go.dev",
    "pkg.go.dev",
    "www.php.net",
    "docs.swift.org",
    "kotlinlang.org",
    "ruby-doc.org",
    "doc.rust-lang.org",
    "docs.rs",
    "www.typescriptlang.org",
    // Web and JS frameworks
    "react.dev",
    "angular.io",
    "vuejs.org",
    "nextjs.org",
    "expressjs.com",
    "nodejs.org",
    "bun.sh",
    "tailwindcss.com",
    "redux.js.org",
    "webpack.js.org",
    "jestjs.io",
    // Python frameworks
    "docs.djangoproject.com",
    "flask.palletsprojects.com",
    "fastapi.tiangolo.com",
    "pandas.pydata.org",
    "numpy.org",
    "www.tensorflow.org",
    "pytorch.org",
    "scikit-learn.org",
    "requests.readthedocs.io",
    "jupyter.org",
    // Java frameworks
    "docs.spring.io",
    "hibernate.org",
    "gradle.org",
    "maven.apache.org",
    // .NET
    "dotnet.microsoft.com",
    "nuget.org",
    // Mobile
    "reactnative.dev",
    "docs.flutter.dev",
    "developer.apple.com",
    "developer.android.com",
    // Data / ML
    "huggingface.co",
    // Databases
    "redis.io",
    "www.postgresql.org",
    "dev.mysql.com",
    "www.sqlite.org",
    "graphql.org",
    "prisma.io",
    // Cloud / DevOps
    "docs.aws.amazon.com",
    "kubernetes.io",
    "www.docker.com",
    "www.terraform.io",
    "vercel.com/docs",
    "docs.netlify.com",
    // Other
    "git-scm.com",
    "nginx.org",
    // Community Q&A (Stack Exchange network)
    "stackoverflow.com",
    "serverfault.com",
    "superuser.com",
    "askubuntu.com",
    "stackexchange.com",
    // Reddit
    "reddit.com",
    // Wikipedia (English + root; language subdomains share the same host shape)
    "wikipedia.org",
    "en.wikipedia.org",
    "en.m.wikipedia.org",
    // Academic / preprints
    "arxiv.org",
    "dl.acm.org",
    "ieeexplore.ieee.org",
    "scholar.google.com",
    // Standards / RFCs
    "datatracker.ietf.org",
    "www.rfc-editor.org",
    "rfc-editor.org",
    "www.w3.org",
    "w3.org",
    "html.spec.whatwg.org",
    "ecma-international.org",
    // GitHub (issues / PRs / discussions / releases / gist / raw)
    "github.com",
    "gist.github.com",
    "raw.githubusercontent.com",
    "docs.github.com",
    "github.blog",
    // Blogs / articles
    "medium.com",
    "dev.to",
    "freecodecamp.org",
    "hackernoon.com",
    "alexelcu.com",
    // Package registries
    "www.npmjs.com",
    "registry.npmjs.org",
    "crates.io",
    "lib.rs",
    "pypi.org",
    "pub.dev",
    "mvnrepository.com",
    // Cloud docs commonly referenced
    "cloud.google.com",
    "cloud.ibm.com",
    "docs.databricks.com",
    "docs.snowflake.com",
    "dev.mysql.com",
    // Misc dev references
    "gitlab.com",
    "bitbucket.org",
    "www.jetbrains.com",
    "kotlinlang.org",
];
