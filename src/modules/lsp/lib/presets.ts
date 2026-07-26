import type { LspCustomServer } from "@/modules/settings/store";

export type LspPreset = {
  id: string;
  name: string;
  command: string;
  args: string[];
  /** languageResolver id -> LSP languageId */
  languages: Record<string, string>;
  rootMarkers: string[];
  initializationOptions?: unknown;
  env?: Record<string, string>;
  maxMemoryMb?: number;
  /** Absent for user-defined servers. */
  install?: { command: string; docsUrl: string };
};

export const LSP_PRESETS: LspPreset[] = [
  {
    id: "typescript",
    name: "TypeScript",
    command: "typescript-language-server",
    args: ["--stdio"],
    languages: {
      ts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      jsx: "javascriptreact",
    },
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    initializationOptions: { maxTsServerMemory: 3072 },
    install: {
      command: "npm install -g typescript-language-server typescript",
      docsUrl:
        "https://github.com/typescript-language-server/typescript-language-server",
    },
  },
  {
    id: "rust-analyzer",
    name: "Rust",
    command: "rust-analyzer",
    args: [],
    languages: { rs: "rust" },
    rootMarkers: ["Cargo.toml"],
    // Measured: default profile settles at ~3 GB resident, this one at ~1 GB,
    // trading analysis inside proc macros and cargo-check diagnostics.
    initializationOptions: {
      cachePriming: { enable: false },
      lru: { capacity: 32 },
      checkOnSave: false,
      procMacro: { enable: false },
      cargo: { buildScripts: { enable: false } },
      diagnostics: {
        disabled: ["unresolved-proc-macro", "unresolved-macro-call"],
      },
    },
    env: { CARGO_BUILD_JOBS: "2" },
    maxMemoryMb: 3072,
    install: {
      command: "rustup component add rust-analyzer",
      docsUrl: "https://rust-analyzer.github.io/book/installation.html",
    },
  },
  {
    id: "pyright",
    name: "Python",
    command: "pyright-langserver",
    args: ["--stdio"],
    languages: { py: "python" },
    rootMarkers: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
    install: {
      command: "npm install -g pyright",
      docsUrl: "https://microsoft.github.io/pyright/#/installation",
    },
  },
  {
    id: "ruff",
    name: "Ruff",
    command: "ruff",
    args: ["server"],
    languages: { py: "python" },
    rootMarkers: [
      "pyproject.toml",
      "ruff.toml",
      ".ruff.toml",
      "setup.py",
      "requirements.txt",
    ],
    install: {
      command: "pip install ruff",
      docsUrl: "https://docs.astral.sh/ruff/editors/",
    },
  },
  {
    id: "gopls",
    name: "Go",
    command: "gopls",
    args: [],
    languages: { go: "go" },
    rootMarkers: ["go.mod", "go.work"],
    install: {
      command: "go install golang.org/x/tools/gopls@latest",
      docsUrl: "https://pkg.go.dev/golang.org/x/tools/gopls#section-readme",
    },
  },
  {
    id: "clangd",
    name: "C/C++",
    command: "clangd",
    args: [],
    languages: { c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp" },
    rootMarkers: [
      "compile_commands.json",
      "CMakeLists.txt",
      "Makefile",
      ".clangd",
    ],
    install: {
      command: "brew install llvm",
      docsUrl: "https://clangd.llvm.org/installation",
    },
  },
  {
    id: "zls",
    name: "Zig",
    command: "zls",
    args: [],
    languages: { zig: "zig" },
    rootMarkers: ["build.zig"],
    install: {
      command: "brew install zls",
      docsUrl: "https://zigtools.org/zls/install/",
    },
  },
  {
    id: "lua-ls",
    name: "Lua",
    command: "lua-language-server",
    args: [],
    languages: { lua: "lua" },
    rootMarkers: [".luarc.json", ".luarc.jsonc"],
    install: {
      command: "brew install lua-language-server",
      docsUrl: "https://luals.github.io/#install",
    },
  },
  {
    id: "ruby-lsp",
    name: "Ruby",
    command: "ruby-lsp",
    args: [],
    languages: { rb: "ruby" },
    rootMarkers: ["Gemfile"],
    install: {
      command: "gem install ruby-lsp",
      docsUrl: "https://shopify.github.io/ruby-lsp/",
    },
  },
  {
    id: "intelephense",
    name: "PHP",
    command: "intelephense",
    args: ["--stdio"],
    languages: { php: "php" },
    rootMarkers: ["composer.json"],
    install: {
      command: "npm install -g intelephense",
      docsUrl: "https://intelephense.com",
    },
  },
  {
    id: "yaml-ls",
    name: "YAML",
    command: "yaml-language-server",
    args: ["--stdio"],
    languages: { yaml: "yaml", yml: "yaml" },
    rootMarkers: [".git"],
    install: {
      command: "npm install -g yaml-language-server",
      docsUrl: "https://github.com/redhat-developer/yaml-language-server",
    },
  },
  {
    id: "bash-ls",
    name: "Shell",
    command: "bash-language-server",
    args: ["start"],
    languages: { sh: "shellscript", bash: "shellscript", zsh: "shellscript" },
    rootMarkers: [".git"],
    install: {
      command: "npm install -g bash-language-server",
      docsUrl: "https://github.com/bash-lsp/bash-language-server",
    },
  },
  {
    id: "json-ls",
    name: "JSON",
    command: "vscode-json-language-server",
    args: ["--stdio"],
    languages: { json: "json" },
    rootMarkers: [".git"],
    install: {
      command: "npm install -g vscode-langservers-extracted",
      docsUrl: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
  },
  {
    id: "css-ls",
    name: "CSS",
    command: "vscode-css-language-server",
    args: ["--stdio"],
    languages: { css: "css", scss: "scss", less: "less" },
    rootMarkers: ["package.json", ".git"],
    install: {
      command: "npm install -g vscode-langservers-extracted",
      docsUrl: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
  },
  {
    id: "html-ls",
    name: "HTML",
    command: "vscode-html-language-server",
    args: ["--stdio"],
    languages: { html: "html" },
    rootMarkers: ["package.json", ".git"],
    install: {
      command: "npm install -g vscode-langservers-extracted",
      docsUrl: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
  },
  {
    id: "svelte-ls",
    name: "Svelte",
    command: "svelteserver",
    args: ["--stdio"],
    languages: { svelte: "svelte" },
    rootMarkers: ["svelte.config.js", "package.json"],
    install: {
      command: "npm install -g svelte-language-server",
      docsUrl: "https://github.com/sveltejs/language-tools",
    },
  },
  {
    id: "vue-ls",
    name: "Vue",
    command: "vue-language-server",
    args: ["--stdio"],
    languages: { vue: "vue" },
    rootMarkers: ["vite.config.ts", "vite.config.js", "package.json"],
    install: {
      command: "npm install -g @vue/language-server",
      docsUrl: "https://github.com/vuejs/language-tools",
    },
  },
  {
    id: "sourcekit",
    name: "Swift",
    command: "sourcekit-lsp",
    args: [],
    languages: { swift: "swift" },
    rootMarkers: ["Package.swift"],
    install: {
      command: "xcode-select --install",
      docsUrl: "https://github.com/swiftlang/sourcekit-lsp",
    },
  },
  {
    id: "java-eclipse",
    name: "Java (Eclipse)",
    command: "jdtls",
    args: [],
    languages: { java: "java", cls: "java" },
    rootMarkers: ["pom.xml", "build.gradle", ".classpath"],
    install: {
      command: "Install Eclipse JDT Language Server from https://download.eclipse.org/jdtls/snapshots/",
      docsUrl: "https://github.com/eclipse-jdtls/eclipse.jdt.ls",
    },
  },
  {
    id: "gradle",
    name: "Groovy",
    command: "groovy-language-server",
    args: [],
    languages: { groovy: "groovy", gdsl: "groovy", gant: "groovy" },
    rootMarkers: ["build.gradle", "pom.xml"],
    install: {
      command: "npm install -g groovy-language-server",
      docsUrl: "https://github.com/GroovyLanguageServer/groovy-language-server",
    },
  },
  {
    id: "kotlin",
    name: "Kotlin",
    command: "kotlin-language-server",
    args: [],
    languages: { kt: "kotlin", kts: "kotlin", ktm: "kotlin" },
    rootMarkers: ["build.gradle.kts", "settings.gradle.kts", "pom.xml"],
    install: {
      command: "Install kotlin-language-server from https://github.com/fwcd/kotlin-language-server",
      docsUrl: "https://github.com/fwcd/kotlin-language-server",
    },
  },
  {
    id: "dart",
    name: "Dart",
    command: "dart",
    args: ["language-server", "--protocol=lsp"],
    languages: { dart: "dart" },
    rootMarkers: ["pubspec.yaml", ".dart_tool"],
    install: {
      command: "Install Dart SDK from https://dart.dev/get-dart",
      docsUrl: "https://dart.dev/tools/language-server",
    },
  },
  {
    id: "elixir",
    name: "Elixir",
    command: "elixir-ls",
    args: [],
    languages: { ex: "elixir", exs: "elixir" },
    rootMarkers: ["mix.exs"],
    install: {
      command: "Install Elixir LS from https://github.com/elixir-lsp/elixir-ls",
      docsUrl: "https://github.com/elixir-lsp/elixir-ls",
    },
  },
  {
    id: "erlang",
    name: "Erlang",
    command: "erlang_ls",
    args: [],
    languages: { erl: "erlang", hrl: "erlang" },
    rootMarkers: ["rebar.config", "erlang.mk", "Makefile"],
    install: {
      command: "Install erlang_ls from https://github.com/erlang-ls/erlang_ls",
      docsUrl: "https://github.com/erlang-ls/erlang_ls",
    },
  },
  {
    id: "haskell",
    name: "Haskell",
    command: "haskell-language-server-wrapper",
    args: [],
    languages: { hs: "haskell", lhs: "haskell" },
    rootMarkers: ["*.cabal", "stack.yaml", "hie.yaml"],
    install: {
      command: "Install haskell-language-server from https://github.com/haskell/haskell-language-server",
      docsUrl: "https://github.com/haskell/haskell-language-server",
    },
  },
  {
    id: "ocaml",
    name: "OCaml",
    command: "ocamllsp",
    args: [],
    languages: { ml: "ocaml", mli: "ocaml" },
    rootMarkers: ["dune-project", "*.opam", "Makefile"],
    install: {
      command: "opam install ocaml-lsp-server",
      docsUrl: "https://github.com/ocaml/ocaml-lsp",
    },
  },
  {
    id: "rescript",
    name: "ReScript",
    command: "rescript",
    args: ["lsp"],
    languages: { res: "rescript", resi: "rescript" },
    rootMarkers: ["rescript.json", "bsconfig.json"],
    install: {
      command: "npm install -g rescript",
      docsUrl: "https://rescript-lang.org/docs/manual/latest/editor-plugins",
    },
  },
  {
    id: "reason",
    name: "ReasonML",
    command: "reason-language-server",
    args: [],
    languages: { re: "reason", rei: "reason" },
    rootMarkers: ["bsconfig.json", "dune-project"],
    install: {
      command: "npm install -g reason-language-server",
      docsUrl: "https://github.com/jaredly/reason-language-server",
    },
  },
  {
    id: "terraform",
    name: "Terraform",
    command: "terraform-ls",
    args: ["serve"],
    languages: { tf: "terraform", tfvars: "terraform" },
    rootMarkers: [".terraform", "*.tf"],
    install: {
      command: "Install terraform-ls from https://github.com/hashicorp/terraform-ls",
      docsUrl: "https://developer.hashicorp.com/terraform/language/language-server",
    },
  },
  {
    id: "dockerfile",
    name: "Dockerfile",
    command: "docker-langserver",
    args: ["--stdio"],
    languages: { dockerfile: "dockerfile" },
    rootMarkers: ["Dockerfile", ".dockerignore"],
    install: {
      command: "npm install -g dockerfile-language-server-nodejs",
      docsUrl: "https://github.com/rcjsuen/dockerfile-language-server-nodejs",
    },
  },
  {
    id: "graphql",
    name: "GraphQL",
    command: "graphql-language-service-server",
    args: [],
    languages: { graphql: "graphql", gql: "graphql" },
    rootMarkers: [".graphqlrc", ".graphqlconfig", "package.json"],
    install: {
      command: "npm install -g graphql-language-service-cli",
      docsUrl: "https://github.com/graphql/graphiql/tree/main/packages/graphql-language-service-server",
    },
  },
  {
    id: "protobuf",
    name: "Protobuf",
    command: "protols",
    args: [],
    languages: { proto: "proto" },
    rootMarkers: ["*.proto", "buf.yaml", "buf.gen.yaml"],
    install: {
      command: "Install protols from https://github.com/chrisvittal/protols",
      docsUrl: "https://github.com/chrisvittal/protols",
    },
  },
  {
    id: "thrift",
    name: "Thrift",
    command: "thrift-ls",
    args: [],
    languages: { thrift: "thrift" },
    rootMarkers: ["*.thrift"],
    install: {
      command: "Install thrift-ls from https://github.com/joyieldInc/thriftls",
      docsUrl: "https://github.com/joyieldInc/thriftls",
    },
  },
  {
    id: "nginx",
    name: "Nginx",
    command: "nginx-language-server",
    args: [],
    languages: { conf: "nginx", nginx: "nginx" },
    rootMarkers: ["nginx.conf", "sites-enabled"],
    install: {
      command: "npm install -g nginx-language-server",
      docsUrl: "https://github.com/pappasam/nginx-language-server",
    },
  },
  {
    id: "cmake",
    name: "CMake",
    command: "cmake-language-server",
    args: [],
    languages: { cmake: "cmake", "CMakeLists.txt": "cmake" },
    rootMarkers: ["CMakeLists.txt", "*.cmake"],
    install: {
      command: "pip install cmake-language-server",
      docsUrl: "https://github.com/regen100/cmake-language-server",
    },
  },
  {
    id: "make",
    name: "Make",
    command: "make-language-server",
    args: [],
    languages: { makefile: "makefile", "GNUmakefile": "makefile", "Makefile": "makefile" },
    rootMarkers: ["Makefile", "GNUmakefile"],
    install: {
      command: "npm install -g make-language-server",
      docsUrl: "https://github.com/evangie/make-language-server",
    },
  },
  {
    id: "docker-compose",
    name: "Docker Compose",
    command: "yaml-language-server",
    args: ["--stdio"],
    languages: { "docker-compose.yml": "yaml", "docker-compose.yaml": "yaml" },
    rootMarkers: ["docker-compose.yml", "docker-compose.yaml"],
    install: {
      command: "npm install -g yaml-language-server",
      docsUrl: "https://github.com/redhat-developer/yaml-language-server",
    },
  },
  {
    id: "toml",
    name: "TOML",
    command: "taplo",
    args: ["lsp", "--stdio"],
    languages: { toml: "toml" },
    rootMarkers: ["Cargo.toml", "pyproject.toml", "*.toml"],
    install: {
      command: "cargo install taplo-cli",
      docsUrl: "https://taplo.tamasfe.dev/",
    },
  },
  {
    id: "ini",
    name: "INI",
    command: "ini-language-server",
    args: [],
    languages: { ini: "ini", cfg: "ini", conf: "ini" },
    rootMarkers: [".git", "*.ini"],
    install: {
      command: "npm install -g ini-language-server",
      docsUrl: "https://github.com/evangie/ini-language-server",
    },
  },
  {
    id: "editorconfig",
    name: "EditorConfig",
    command: "editorconfig-checker",
    args: [],
    languages: { editorconfig: "editorconfig" },
    rootMarkers: [".editorconfig"],
    install: {
      command: "Install editorconfig-checker from https://github.com/editorconfig-checker/editorconfig-checker",
      docsUrl: "https://editorconfig.org/",
    },
  },
  {
    id: "sql",
    name: "SQL",
    command: "sql-language-server",
    args: [],
    languages: { sql: "sql", mysql: "sql", pgsql: "sql" },
    rootMarkers: [".git", ".sql"],
    install: {
      command: "npm install -g sql-language-server",
      docsUrl: "https://github.com/joe-re/sql-language-server",
    },
  },
  {
    id: "csharp",
    name: "C#",
    command: "omnisharp",
    args: ["-lsp"],
    languages: { cs: "csharp", csx: "csharp" },
    rootMarkers: ["*.csproj", "*.sln", "project.json", "global.json"],
    install: {
      command: "Install OmniSharp from https://github.com/OmniSharp/omnisharp-roslyn",
      docsUrl: "https://www.omnisharp.net/",
    },
  },
  {
    id: "fsharp",
    name: "F#",
    command: "fsautocomplete",
    args: ["--background-service-enabled"],
    languages: { fs: "fsharp", fsx: "fsharp" },
    rootMarkers: ["*.fsproj", "*.sln"],
    install: {
      command: "Install FsAutoComplete from https://github.com/fsharp/FsAutoComplete",
      docsUrl: "https://github.com/fsharp/FsAutoComplete",
    },
  },
  {
    id: "vb",
    name: "Visual Basic",
    command: "omnisharp",
    args: ["-lsp"],
    languages: { vb: "vb", vbs: "vb" },
    rootMarkers: ["*.vbproj", "*.sln"],
    install: {
      command: "Install OmniSharp from https://github.com/OmniSharp/omnisharp-roslyn",
      docsUrl: "https://www.omnisharp.net/",
    },
  },
  {
    id: "powershell",
    name: "PowerShell",
    command: "pwsh",
    args: ["-NoLogo", "-NoProfile", "-Command", "Start-Process -NoNewWindow pwsh -ArgumentList '-Command', '& { Import-Module PowerShellEditorServices.Commands; Start-PSEditorServices }'"],
    languages: { ps1: "powershell", psm1: "powershell", psd1: "powershell", ps1xml: "powershell" },
    rootMarkers: [".git"],
    install: {
      command: "Install PowerShell Editor Services from https://github.com/PowerShell/PowerShellEditorServices",
      docsUrl: "https://github.com/PowerShell/PowerShellEditorServices",
    },
  },
  {
    id: "r",
    name: "R",
    command: "R",
    args: ["--no-echo", "-e", "languageserver::run()"],
    languages: { r: "r", rmd: "rmd", rpres: "rpres" },
    rootMarkers: ["DESCRIPTION", ".Rprofile"],
    install: {
      command: "install.packages('languageserver') in R",
      docsUrl: "https://github.com/REditorSupport/languageserver",
    },
  },
  {
    id: "julia",
    name: "Julia",
    command: "julia",
    args: ["--project=languagesserver", "-e", "using LanguageServer; runserver()"],
    languages: { jl: "julia" },
    rootMarkers: ["Project.toml", "Manifest.toml"],
    install: {
      command: "using Pkg; Pkg.add('LanguageServer') in Julia",
      docsUrl: "https://github.com/julia-vscode/LanguageServer.jl",
    },
  },
  {
    id: "matlab",
    name: "MATLAB",
    command: "matlab-language-server",
    args: [],
    languages: { m: "matlab" },
    rootMarkers: ["*.m"],
    install: {
      command: "Install matlab-language-server from https://github.com/xconverge/matlab-language-server",
      docsUrl: "https://github.com/xconverge/matlab-language-server",
    },
  },
  {
    id: "scala",
    name: "Scala",
    command: "metals",
    args: [],
    languages: { scala: "scala", sc: "scala" },
    rootMarkers: ["build.sbt", "build.sc", "pom.xml", "build.gradle"],
    install: {
      command: "Install Metals from https://scalameta.org/metals/",
      docsUrl: "https://scalameta.org/metals/docs/developers/backend-server",
    },
  },
  {
    id: "crystal",
    name: "Crystal",
    command: "crystalline",
    args: ["--stdio"],
    languages: { cr: "crystal" },
    rootMarkers: ["shard.yml"],
    install: {
      command: "Install scry from https://github.com/crystal-lang-tools/scry",
      docsUrl: "https://github.com/crystal-lang-tools/scry",
    },
  },
  {
    id: "nim",
    name: "Nim",
    command: "nimlsp",
    args: [],
    languages: { nim: "nim", nims: "nim" },
    rootMarkers: ["*.nimble", ".nimble"],
    install: {
      command: "nimble install nimlsp",
      docsUrl: "https://github.com/PMunch/nimlsp",
    },
  },
  {
    id: "solidity",
    name: "Solidity",
    command: "nomicfoundation-solidity-language-server",
    args: [],
    languages: { sol: "solidity" },
    rootMarkers: ["hardhat.config.ts", "hardhat.config.js", "foundry.toml", "truffle-config.js"],
    install: {
      command: "Install nomicfoundation-solidity-language-server from npm",
      docsUrl: "https://hardhat.org/hardhat-runner/plugins/nomicfoundation-solidity-language-server",
    },
  },
  {
    id: "move",
    name: "Move (Sui)",
    command: "move-analyzer",
    args: [],
    languages: { move: "move" },
    rootMarkers: ["Move.toml", ".move"],
    install: {
      command: "cargo install move-analyzer",
      docsUrl: "https://github.com/move-language/move/tree/main/language/tools/move-analyzer",
    },
  },
  {
    id: "purescript",
    name: "PureScript",
    command: "purescript-language-server",
    args: [],
    languages: { purs: "purescript" },
    rootMarkers: ["spago.dhall", "psc-package.json", "bower.json"],
    install: {
      command: "npm install -g purescript-language-server",
      docsUrl: "https://github.com/nwolverson/purescript-language-server",
    },
  },
  {
    id: "racket",
    name: "Racket",
    command: "racket",
    args: ["-l", "racket-langserver"],
    languages: { rkt: "racket", scrbl: "racket", ss: "racket" },
    rootMarkers: ["info.rkt"],
    install: {
      command: "raco pkg install racket-langserver",
      docsUrl: "https://github.com/jeapostrophe/racket-langserver",
    },
  },
  {
    id: "clojure",
    name: "Clojure",
    command: "clojure-lsp",
    args: [],
    languages: {
      clj: "clojure",
      cljs: "clojurescript",
      cljc: "clojure",
      edn: "clojure",
    },
    rootMarkers: ["project.clj", "deps.edn", "build.clj"],
    install: {
      command: "Install clojure-lsp from https://github.com/clojure-lsp/clojure-lsp",
      docsUrl: "https://clojure-lsp.io/",
    },
  },
  {
    id: "common-lisp",
    name: "Common Lisp",
    command: "cl-lsp",
    args: ["--stdio"],
    languages: { lisp: "lisp", lsp: "lisp", cl: "lisp" },
    rootMarkers: [".git", "*.asd"],
    install: {
      command: "Install cl-lsp from https://github.com/cxxxr/cl-lsp",
      docsUrl: "https://github.com/cxxxr/cl-lsp",
    },
  },
  {
    id: "coq",
    name: "Coq",
    command: "coq-lsp",
    args: [],
    languages: { v: "coq" },
    rootMarkers: ["_CoqProject", "*.v"],
    install: {
      command: "opam install coq-lsp",
      docsUrl: "https://github.com/ejgallego/coq-lsp",
    },
  },
  {
    id: "lean",
    name: "Lean 4",
    command: "lean-language-server",
    args: [],
    languages: { lean: "lean", "lean4": "lean4" },
    rootMarkers: ["lakefile.lean", "lean-toolchain"],
    install: {
      command: "Install lean-language-server from https://github.com/leanprover-community/lean4",
      docsUrl: "https://github.com/leanprover-community/lean4",
    },
  },
  {
    id: "agda",
    name: "Agda",
    command: "agda",
    args: ["--interaction"],
    languages: { agda: "agda", lagda: "agda" },
    rootMarkers: [".agda-lib", "*.agda"],
    install: {
      command: "Install Agda from https://wiki.portal.chalmers.se/agda/",
      docsUrl: "https://agda.readthedocs.io/en/latest/tools/command-line.html",
    },
  },
  {
    id: "idris",
    name: "Idris 2",
    command: "idris2-lsp",
    args: [],
    languages: { idr: "idris", lidr: "idris" },
    rootMarkers: ["*.ipkg"],
    install: {
      command: "Install idris2-lsp from https://github.com/joaomilho/idris2-lsp",
      docsUrl: "https://github.com/joaomilho/idris2-lsp",
    },
  },
  {
    id: "fortran",
    name: "Fortran",
    command: "fortls",
    args: [],
    languages: { f: "fortran", f90: "fortran", f95: "fortran", f03: "fortran", f08: "fortran" },
    rootMarkers: ["*.f90", "*.f", "CMakeLists.txt"],
    install: {
      command: "pip install fortls",
      docsUrl: "https://github.com/fortran-lang/fortran-language-server",
    },
  },
  {
    id: "ada",
    name: "Ada",
    command: "ada_language_server",
    args: [],
    languages: { ada: "ada", ads: "ada", adb: "ada" },
    rootMarkers: ["*.gpr", "Makefile"],
    install: {
      command: "Install ada_language_server from https://github.com/AdaCore/ada_language_server",
      docsUrl: "https://github.com/AdaCore/ada_language_server",
    },
  },
  {
    id: "zig",
    name: "Zig",
    command: "zls",
    args: [],
    languages: { zig: "zig", zir: "zig" },
    rootMarkers: ["build.zig"],
    install: {
      command: "Install zls from https://github.com/zigtools/zls",
      docsUrl: "https://zigtools.org/zls/install/",
    },
  },
  {
    id: "tex",
    name: "LaTeX",
    command: "texlab",
    args: [],
    languages: { tex: "tex", sty: "tex", cls: "tex", bst: "tex", bib: "bibtex" },
    rootMarkers: [".latexmkrc", "*.tex"],
    install: {
      command: "Install texlab from https://github.com/latex-lsp/texlab",
      docsUrl: "https://texlab.netlify.app/",
    },
  },
  {
    id: "markdown-ls",
    name: "Markdown",
    command: "markdown-language-server",
    args: ["--stdio"],
    languages: { md: "markdown", mdx: "markdown", markdown: "markdown" },
    rootMarkers: [".git"],
    install: {
      command: "npm install -g markdown-language-server",
      docsUrl: "https://github.com/artempankratov/markdown-language-server",
    },
  },
  {
    id: "remark",
    name: "Remark (Markdown Lint)",
    command: "remark-language-server",
    args: [],
    languages: { md: "markdown", mdx: "markdown", markdown: "markdown" },
    rootMarkers: [".remarkrc", "package.json"],
    install: {
      command: "npm install -g remark-language-server",
      docsUrl: "https://github.com/remarkjs/remark-language-server",
    },
  },
  {
    id: "tailwindcss",
    name: "Tailwind CSS",
    command: "tailwindcss-language-server",
    args: ["--stdio"],
    languages: { css: "css", scss: "scss", html: "html", tsx: "typescriptreact", jsx: "javascriptreact" },
    rootMarkers: ["tailwind.config.ts", "tailwind.config.js", "postcss.config.js", "package.json"],
    install: {
      command: "npm install -g @tailwindcss/language-server",
      docsUrl: "https://tailwindcss.com/blog/automatic-class-detection-with-intellisense",
    },
  },
  {
    id: "emmet",
    name: "Emmet",
    command: "emmet-language-server",
    args: [],
    languages: { html: "html", css: "css", scss: "scss", jsx: "javascriptreact", tsx: "typescriptreact" },
    rootMarkers: [".git"],
    install: {
      command: "npm install -g emmet-language-server",
      docsUrl: "https://github.com/olrtg/emmet-language-server",
    },
  },
  {
    id: "astro",
    name: "Astro",
    command: "@astrojs/language-server",
    args: ["--stdio"],
    languages: { astro: "astro" },
    rootMarkers: ["astro.config.mjs", "astro.config.ts", "astro.config.js"],
    install: {
      command: "npm install -g @astrojs/language-server",
      docsUrl: "https://docs.astro.build/en/editorial-setup/#language-server",
    },
  },
  {
    id: "svelte-ls-ext",
    name: "Svelte (Extended)",
    command: "svelteserver",
    args: ["--stdio"],
    languages: { svelte: "svelte" },
    rootMarkers: ["svelte.config.js", "svelte.config.ts", "package.json"],
    install: {
      command: "npm install -g svelte-language-server",
      docsUrl: "https://github.com/sveltejs/language-tools",
    },
  },
  {
    id: "vue-ls-ext",
    name: "Vue (Extended)",
    command: "vue-language-server",
    args: ["--stdio"],
    languages: { vue: "vue" },
    rootMarkers: ["vite.config.ts", "vite.config.js", "nuxt.config.ts", "package.json"],
    install: {
      command: "npm install -g @vue/language-server",
      docsUrl: "https://github.com/vuejs/language-tools",
    },
  },
  {
    id: "angular",
    name: "Angular",
    command: "ngserver",
    args: ["--stdio", "--tsProbeLocations", "--ngProbeLocations"],
    languages: { ts: "typescript", html: "html" },
    rootMarkers: ["angular.json", ".angular"],
    install: {
      command: "npm install -g @angular/language-server",
      docsUrl: "https://angular.io/guide/language-service",
    },
  },
  {
    id: "nextjs",
    name: "Next.js",
    command: "typescript-language-server",
    args: ["--stdio"],
    languages: { ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact" },
    rootMarkers: ["next.config.ts", "next.config.js", "next.config.mjs"],
    install: {
      command: "npm install -g typescript-language-server",
      docsUrl: "https://nextjs.org/docs/pages/building-your-application/configuring/typescript",
    },
  },
  {
    id: "prisma",
    name: "Prisma",
    command: "prisma-language-server",
    args: ["--stdio"],
    languages: { prisma: "prisma" },
    rootMarkers: ["prisma/schema.prisma", "schema.prisma"],
    install: {
      command: "npm install -g @prisma/language-server",
      docsUrl: "https://www.prisma.io/docs/guides/development-environment/editor-setup#language-server",
    },
  },
  {
    id: "mongodb",
    name: "MongoDB",
    command: "mongodb-language-server",
    args: [],
    languages: { js: "javascript", ts: "typescript" },
    rootMarkers: ["package.json", "mongodb"],
    install: {
      command: "npm install -g mongodb-language-server",
      docsUrl: "https://www.mongodb.com/docs/language-server/",
    },
  },
  {
    id: "deno",
    name: "Deno",
    command: "deno",
    args: ["lsp"],
    languages: { js: "javascript", ts: "typescript", jsx: "javascriptreact", tsx: "typescriptreact", mjs: "javascript", mts: "typescript" },
    rootMarkers: ["deno.json", "deno.jsonc", "import_map.json"],
    install: {
      command: "Install Deno from https://deno.land/manual/getting_started/installation",
      docsUrl: "https://deno.land/manual/getting_started/setup_your_environment#language-server",
    },
  },
  {
    id: "biome-ls",
    name: "Biome",
    command: "biome",
    args: ["lsp-proxy"],
    languages: { js: "javascript", ts: "typescript", jsx: "javascriptreact", tsx: "typescriptreact", json: "json", jsonc: "json" },
    rootMarkers: ["biome.json", "biome.jsonc"],
    install: {
      command: "npm install -g @biomejs/biome",
      docsUrl: "https://biomejs.dev/reference/lsp/",
    },
  },
  {
    id: "oxlint",
    name: "Oxlint",
    command: "oxlint",
    args: ["--server"],
    languages: { js: "javascript", ts: "typescript", jsx: "javascriptreact", tsx: "typescriptreact" },
    rootMarkers: [".oxlintrc.json", "oxlint.json"],
    install: {
      command: "npm install -g oxlint",
      docsUrl: "https://oxc-project.github.io/docs/guide/linter.html",
    },
  },
  {
    id: "eslint",
    name: "ESLint",
    command: "eslint",
    args: ["--stdin", "--stdin-filename", "--format=json"],
    languages: { js: "javascript", ts: "typescript", jsx: "javascriptreact", tsx: "typescriptreact", mjs: "javascript", mts: "typescript" },
    rootMarkers: [".eslintrc", ".eslintrc.json", ".eslintrc.js", "eslint.config.js", "eslint.config.mjs", "package.json"],
    install: {
      command: "npm install -g eslint",
      docsUrl: "https://eslint.org/docs/latest/use/integrations#language-server",
    },
  },
  {
    id: "stylelint",
    name: "Stylelint",
    command: "stylelint-lsp",
    args: [],
    languages: { css: "css", scss: "scss", less: "less" },
    rootMarkers: [".stylelintrc", ".stylelintrc.json", "stylelint.config.js", "package.json"],
    install: {
      command: "npm install -g stylelint-lsp",
      docsUrl: "https://github.com/stylelint/stylelint-lsp",
    },
  },
  {
    id: "prettier",
    name: "Prettier",
    command: "prettierd",
    args: ["start"],
    languages: {
      js: "javascript", ts: "typescript", jsx: "javascriptreact", tsx: "typescriptreact",
      json: "json", jsonc: "json", yaml: "yaml", css: "css", scss: "scss",
      html: "html", md: "markdown",
    },
    rootMarkers: [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js", "package.json"],
    install: {
      command: "npm install -g @fsouza/prettierd",
      docsUrl: "https://github.com/fsouza/prettierd",
    },
  },
  {
    id: "ruff-ls",
    name: "Ruff (Extended)",
    command: "ruff",
    args: ["server"],
    languages: { py: "python" },
    rootMarkers: ["pyproject.toml", "ruff.toml", ".ruff.toml"],
    install: {
      command: "pip install ruff",
      docsUrl: "https://docs.astral.sh/ruff/editors/",
    },
  },
  {
    id: "mypy",
    name: "Mypy",
    command: "mypy",
    args: ["--show-error-codes", "--no-site-packages", "--ignore-missing-imports"],
    languages: { py: "python" },
    rootMarkers: ["pyproject.toml", "mypy.ini", ".mypy.ini", "setup.cfg"],
    install: {
      command: "pip install mypy",
      docsUrl: "https://mypy-lang.org/",
    },
  },
];

function fromCustom(server: LspCustomServer): LspPreset {
  return {
    id: server.id,
    name: server.name,
    command: server.command,
    args: server.args,
    languages: server.languages,
    rootMarkers: server.rootMarkers,
  };
}

export function allServers(custom: LspCustomServer[]): LspPreset[] {
  return [...LSP_PRESETS, ...custom.map(fromCustom)];
}

export function serversForLanguage(
  langId: string | null,
  custom: LspCustomServer[],
): LspPreset[] {
  if (!langId) return [];
  return allServers(custom).filter((p) => langId in p.languages);
}

// Several presets can claim a language (pyright and ruff both take `py`).
// The enabled one wins; among untouched candidates the first non-dismissed
// is offered by the statusbar hint. Preset order breaks remaining ties.
export function serverForLanguage(
  langId: string | null,
  custom: LspCustomServer[],
  activation?: Record<string, string | undefined>,
): LspPreset | null {
  const candidates = serversForLanguage(langId, custom);
  if (candidates.length === 0) return null;
  if (activation) {
    const enabled = candidates.find((p) => activation[p.id] === "enabled");
    if (enabled) return enabled;
    const fresh = candidates.find((p) => activation[p.id] !== "dismissed");
    if (fresh) return fresh;
  }
  return candidates[0];
}

export function serverById(
  id: string,
  custom: LspCustomServer[],
): LspPreset | null {
  return allServers(custom).find((p) => p.id === id) ?? null;
}
