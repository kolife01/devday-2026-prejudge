// Adapted from schroneko/automated-hachathon-judge @ 23016a7dcfe71cf67a3d9405a84ff3b9021e203c (MIT).
// See reference/published-20261018 and THIRD_PARTY_NOTICES.md.
export function isEvidencePath(path) {
  const parts = path.toLowerCase().split("/");
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((part) => /^(?:tests?|__tests__|specs?|__specs__|e2e|__e2e__|cypress|playwright)$/.test(part))) return false;
  if (/\.(?:tests?|specs?)\.[^./]+$/.test(name)
    || /_tests?\.(?:go|py|rs|rb|php)$/.test(name)
    || /^test_[^/]+\.py$/.test(name)
    || /^(?:test|spec)\.(?:[cm]?[jt]sx?|py|rb|php|go|rs)$/.test(name)
    || name === "conftest.py") return false;
  if (/(?:Test|Tests|Spec|Specs)\.(?:java|kt|kts|cs|swift)$/.test(path.split("/").at(-1))) return false;
  if (parts.slice(0, -1).some((part) => /^(?:node_modules|vendor|\.venv|venv|site-packages|dist|build|target|coverage|\.git|\.next|\.nuxt|generated|__generated__|cache|\.cache|__pycache__|\.ssh|\.aws|\.azure)$/.test(part))) return false;
  if (/^(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb?|cargo\.lock|go\.sum|gemfile\.lock|composer\.lock|poetry\.lock|pipfile\.lock|uv\.lock|pdm\.lock|packages\.lock\.json|flake\.lock|mix\.lock|pubspec\.lock|gradle\.lockfile|.*\.lock)$/.test(name)) return false;
  if (/^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|_netrc|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?)$/.test(name)) return false;
  if (/^(?:.*credentials?(?:[._-].*)?|.*private[._-]?key(?:\..*)?|service[._-]?account(?:[._-].*)?|\.?secrets?(?:\..*)?)$/.test(name)
    && !/\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|cs|rb|kt|kts|swift|c|h|cc|cpp|hpp|vue|svelte|php|sh|bash|zsh|fish|ps1|sql)$/.test(name)) return false;
  if (/\.(?:js|mjs|cjs|jsx|ts|tsx|css)\.map$/.test(name)) return false;
  if (/\.(?:svgz?|png|apng|jpe?g|jxl|gif|webp|avif|bmp|tiff?|ico|icns|cur|heic|heif|psd|tga|dds|ktx2?|exr|hdr|pdf|woff2?|ttf|ttc|otf|eot|sfnt|mp[234]|m4[av]|aac|ogg|oga|ogv|opus|flac|wav|aiff?|midi?|mov|avi|mkv|webm|mpeg|mpg|flv|wmv|3gp|3g2|gltf|glb|obj|mtl|stl|fbx|blend|dae|ply|3ds|usda?|usdc|usdz|onnx|safetensors|gguf|ggml|ckpt|tflite|zip|gz|tgz|bz2|xz|zst|7z|rar|tar|jar|war|wasm|exe|dll|so|dylib|bin|o|a|lib|class|pyc|pyo|db|sqlite3?|p12|pfx|pem|key|crt|cer|der|jks|keystore)$/.test(name)) return false;
  return true;
}
