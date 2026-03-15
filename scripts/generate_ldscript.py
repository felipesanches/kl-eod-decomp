#!/usr/bin/env python3
"""Generate ldscript.txt from ldscript.in.txt + [renames] in klonoa-eod-decomp.toml."""

import sys
import tomllib

def main():
    toml_path, template_path, output_path = sys.argv[1:4]

    with open(toml_path, "rb") as f:
        config = tomllib.load(f)

    renames = config.get("renames", {})
    template = open(template_path).read()

    lines = []
    if renames:
        lines.append(f"/* Symbol aliases: auto-generated from {toml_path} [renames]. */")
        for old, new in renames.items():
            lines.append(f"{old} = {new};")
        lines.append("")

    lines.append(template)

    with open(output_path, "w") as f:
        f.write("\n".join(lines))

    print(f"Generated {output_path} ({len(renames)} symbol aliases)")

if __name__ == "__main__":
    main()
