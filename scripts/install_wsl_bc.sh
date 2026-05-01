#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
shim_dir="${HOME}/.local/bin"
shim_path="${shim_dir}/bc"

mkdir -p "$shim_dir"

cat > "$shim_path" <<EOF
#!/usr/bin/env sh
exec node "$repo_root/cli.js" "\$@"
EOF

chmod 755 "$shim_path"

case ":$PATH:" in
  *":$shim_dir:"*)
    echo "Installed Browser Control bc shim: $shim_path"
    ;;
  *)
    echo "Installed Browser Control bc shim: $shim_path"
    echo "Add this before /usr/bin in your shell:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

echo "Run: hash -r && bc --help"
