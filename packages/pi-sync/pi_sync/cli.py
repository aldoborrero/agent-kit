"""pi-sync - Sync skillz repository to ~/.pi/agent/"""

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple


# ─── Colors ──────────────────────────────────────────────────────────────────


class Colors:
    if sys.stdout.isatty():
        RED = "\033[0;31m"
        GREEN = "\033[0;32m"
        YELLOW = "\033[0;33m"
        BLUE = "\033[0;34m"
        BOLD = "\033[1m"
        NC = "\033[0m"
    else:
        RED = GREEN = YELLOW = BLUE = BOLD = NC = ""


# ─── Data Types ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SyncOptions:
    use_symlink: bool = True
    force: bool = False
    dry_run: bool = False
    quiet: bool = False


class ExtensionSource(NamedTuple):
    path: Path
    is_directory: bool


# ─── Globals ─────────────────────────────────────────────────────────────────

opts = SyncOptions()


# ─── Logging ─────────────────────────────────────────────────────────────────


def log(msg: str) -> None:
    if not opts.quiet:
        print(msg)


def warn(msg: str) -> None:
    print(f"{Colors.YELLOW}warning:{Colors.NC} {msg}", file=sys.stderr)


def error(msg: str) -> None:
    print(f"{Colors.RED}error:{Colors.NC} {msg}", file=sys.stderr)


def die(msg: str) -> None:
    error(msg)
    sys.exit(1)


# ─── Discovery ───────────────────────────────────────────────────────────────


def list_extensions(skillz_dir: Path) -> list[str]:
    ext_dir = skillz_dir / "pi" / "extensions"
    if not ext_dir.is_dir():
        return []
    names: set[str] = set()
    for f in ext_dir.rglob("*.ts"):
        if f.name.endswith(".d.ts"):
            continue
        if "node_modules" in f.parts:
            continue
        rel = f.relative_to(ext_dir)
        if len(rel.parts) > 1:
            names.add(rel.parts[0])
        else:
            names.add(rel.stem)
    return sorted(names)


def list_skills(skillz_dir: Path) -> list[str]:
    """List available skills.

    Flat skills (skills/foo/SKILL.md) return "foo".
    Collection skills (skills/collection/bar/SKILL.md) return "collection/bar".
    """
    skills_dir = skillz_dir / "skills"
    if not skills_dir.is_dir():
        return []
    names: set[str] = set()
    for f in skills_dir.rglob("SKILL.md"):
        rel = f.relative_to(skills_dir)
        skill_dir = rel.parent
        if len(skill_dir.parts) == 1:
            # Flat skill: skills/foo/SKILL.md -> "foo"
            names.add(skill_dir.parts[0])
        elif len(skill_dir.parts) >= 2:
            # Collection skill: skills/collection/bar/SKILL.md -> "collection/bar"
            names.add(str(Path(skill_dir.parts[0]) / skill_dir.parts[1]))
    return sorted(names)


def list_agents(skillz_dir: Path) -> list[str]:
    agents_dir = skillz_dir / "pi" / "agents"
    if not agents_dir.is_dir():
        return []
    return sorted(f.stem for f in agents_dir.glob("*.md") if f.is_file())


def list_prompts(skillz_dir: Path) -> list[str]:
    prompts_dir = skillz_dir / "pi" / "prompts"
    if not prompts_dir.is_dir():
        return []
    return sorted(f.stem for f in prompts_dir.glob("*.md") if f.is_file())


def list_themes(skillz_dir: Path) -> list[str]:
    themes_dir = skillz_dir / "pi" / "themes"
    if not themes_dir.is_dir():
        return []
    return sorted(f.stem for f in themes_dir.glob("*.json") if f.is_file())


def get_extension_source(skillz_dir: Path, name: str) -> ExtensionSource | None:
    ext_dir = skillz_dir / "pi" / "extensions"

    # Check for directory with .ts file(s)
    candidate = ext_dir / name
    if candidate.is_dir():
        ts_files = [
            f
            for f in candidate.iterdir()
            if f.suffix == ".ts" and not f.name.endswith(".d.ts") and f.is_file()
        ]
        if ts_files:
            # Directory extension if: has package.json, has multiple .ts files,
            # or has an index.ts entry point
            if (
                (candidate / "package.json").is_file()
                or len(ts_files) > 1
                or (candidate / "index.ts").is_file()
            ):
                return ExtensionSource(candidate, is_directory=True)
            return ExtensionSource(ts_files[0], is_directory=False)

    # Check for direct .ts file
    direct = ext_dir / f"{name}.ts"
    if direct.is_file():
        return ExtensionSource(direct, is_directory=False)

    return None


def get_skill_source(skillz_dir: Path, name: str) -> Path | None:
    """Resolve a skill name to its source directory.

    Supports flat ("ast-grep") and collection ("superpowers/brainstorming") names.
    A collection name without a sub-skill ("superpowers") returns the collection
    directory itself if it contains sub-skill directories.
    """
    candidate = skillz_dir / "skills" / name
    if candidate.is_dir():
        return candidate
    return None


def is_skill_collection(skillz_dir: Path, name: str) -> bool:
    """Check if a name refers to a skill collection (directory of sub-skills)."""
    candidate = skillz_dir / "skills" / name
    if not candidate.is_dir():
        return False
    # A collection has subdirectories with SKILL.md, not a SKILL.md at root
    has_own_skill = (candidate / "SKILL.md").is_file()
    has_sub_skills = any(
        f.parent != candidate for f in candidate.rglob("SKILL.md")
    )
    return has_sub_skills and not has_own_skill


# ─── Sync Functions ──────────────────────────────────────────────────────────


def sync_file(src: Path, dst: Path, kind: str) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)

    if opts.dry_run:
        if opts.use_symlink:
            log(f"  {Colors.BLUE}[dry-run]{Colors.NC} symlink {dst} -> {src}")
        else:
            log(f"  {Colors.BLUE}[dry-run]{Colors.NC} copy {src} -> {dst}")
        return True

    if dst.exists() or dst.is_symlink():
        if opts.force:
            if dst.is_dir() and not dst.is_symlink():
                shutil.rmtree(dst)
            else:
                dst.unlink()
        else:
            warn(f"exists: {dst} (use --force to overwrite)")
            return False

    if opts.use_symlink:
        dst.symlink_to(src)
        log(f"  {Colors.GREEN}symlinked{Colors.NC} {kind}: {dst.name}")
    else:
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
        log(f"  {Colors.GREEN}copied{Colors.NC} {kind}: {dst.name}")

    return True


def sync_extension_dir(src_dir: Path, dst_dir: Path, name: str) -> bool:
    if opts.dry_run:
        if opts.use_symlink:
            log(f"  {Colors.BLUE}[dry-run]{Colors.NC} symlink {dst_dir} -> {src_dir}")
        else:
            log(
                f"  {Colors.BLUE}[dry-run]{Colors.NC} copy {src_dir} -> {dst_dir} (+ npm install)"
            )
        return True

    if dst_dir.exists() or dst_dir.is_symlink():
        if opts.force:
            if dst_dir.is_dir() and not dst_dir.is_symlink():
                shutil.rmtree(dst_dir)
            else:
                dst_dir.unlink()
        else:
            warn(f"exists: {dst_dir} (use --force to overwrite)")
            return False

    dst_dir.parent.mkdir(parents=True, exist_ok=True)

    if opts.use_symlink:
        dst_dir.symlink_to(src_dir)
        log(f"  {Colors.GREEN}symlinked{Colors.NC} extension: {name}/")
    else:
        dst_dir.mkdir(parents=True, exist_ok=True)
        for f in src_dir.iterdir():
            if not f.is_file():
                continue
            if f.suffix == ".ts" and not f.name.endswith(".d.ts"):
                shutil.copy2(f, dst_dir / f.name)
            elif f.name in ("package.json", "package-lock.json", ".gitignore"):
                shutil.copy2(f, dst_dir / f.name)

        if (dst_dir / "package.json").is_file():
            log(
                f"  {Colors.YELLOW}installing{Colors.NC} dependencies for {name}..."
            )
            result = subprocess.run(
                ["npm", "install", "--silent"],
                cwd=dst_dir,
                capture_output=True,
            )
            if result.returncode != 0:
                warn(f"npm install failed for {name}")
                return False
        log(f"  {Colors.GREEN}copied{Colors.NC} extension: {name}/")

    return True


def sync_extensions(
    skillz_dir: Path, agent_dir: Path, items: list[str]
) -> None:
    ext_dir = agent_dir / "extensions"
    log(f"{Colors.BOLD}Syncing extensions...{Colors.NC}")

    if not items:
        items = list_extensions(skillz_dir)
    if not items:
        warn("no extensions found")
        return

    count = 0
    for name in items:
        source = get_extension_source(skillz_dir, name)
        if source is None:
            warn(f"extension not found: {name}")
            continue

        if source.is_directory:
            if sync_extension_dir(source.path, ext_dir / name, name):
                count += 1
        else:
            dst = ext_dir / source.path.name
            if sync_file(source.path, dst, "extension"):
                count += 1

    log(f"  {Colors.BOLD}{count}{Colors.NC} extension(s) synced")


def sync_skills(
    skillz_dir: Path, agent_dir: Path, items: list[str]
) -> None:
    skills_dir = agent_dir / "skills"
    log(f"{Colors.BOLD}Syncing skills...{Colors.NC}")

    if not items:
        items = list_skills(skillz_dir)
    else:
        # Expand collection names to individual sub-skills
        expanded: list[str] = []
        for name in items:
            if is_skill_collection(skillz_dir, name):
                sub_skills = [
                    s for s in list_skills(skillz_dir) if s.startswith(name + "/")
                ]
                expanded.extend(sub_skills)
            else:
                expanded.append(name)
        items = expanded

    if not items:
        warn("no skills found")
        return

    count = 0
    for name in items:
        src = get_skill_source(skillz_dir, name)
        if src is None:
            warn(f"skill not found: {name}")
            continue

        dst = skills_dir / name
        if sync_file(src, dst, "skill"):
            count += 1

    log(f"  {Colors.BOLD}{count}{Colors.NC} skill(s) synced")


def sync_themes(
    skillz_dir: Path, agent_dir: Path, items: list[str]
) -> None:
    themes_dir = agent_dir / "themes"
    log(f"{Colors.BOLD}Syncing themes...{Colors.NC}")

    if not items:
        items = list_themes(skillz_dir)
    if not items:
        warn("no themes found")
        return

    count = 0
    for name in items:
        src = skillz_dir / "pi" / "themes" / f"{name}.json"
        if not src.is_file():
            warn(f"theme not found: {name}")
            continue

        dst = themes_dir / f"{name}.json"
        if sync_file(src, dst, "theme"):
            count += 1

    log(f"  {Colors.BOLD}{count}{Colors.NC} theme(s) synced")


def sync_config(skillz_dir: Path, agent_dir: Path) -> None:
    log(f"{Colors.BOLD}Syncing config...{Colors.NC}")
    pi_dir = skillz_dir / "pi"

    count = 0
    for name in ("AGENTS.md", "SYSTEM.md"):
        src = pi_dir / name
        if src.is_file():
            dst = agent_dir / name
            if sync_file(src, dst, "config"):
                count += 1
        elif name == "AGENTS.md":
            log("  no AGENTS.md found in pi/")

    if count > 0:
        log(f"  {Colors.BOLD}{count}{Colors.NC} config file(s) synced")


def sync_agents(
    skillz_dir: Path, agent_dir: Path, items: list[str]
) -> None:
    agents_dst = agent_dir / "agents"
    log(f"{Colors.BOLD}Syncing agents...{Colors.NC}")

    if not items:
        items = list_agents(skillz_dir)
    if not items:
        warn("no agents found")
        return

    count = 0
    for name in items:
        src = skillz_dir / "pi" / "agents" / f"{name}.md"
        if not src.is_file():
            warn(f"agent not found: {name}")
            continue

        dst = agents_dst / f"{name}.md"
        if sync_file(src, dst, "agent"):
            count += 1

    log(f"  {Colors.BOLD}{count}{Colors.NC} agent(s) synced")


def sync_prompts(
    skillz_dir: Path, agent_dir: Path, items: list[str]
) -> None:
    prompts_dst = agent_dir / "prompts"
    log(f"{Colors.BOLD}Syncing prompts...{Colors.NC}")

    if not items:
        items = list_prompts(skillz_dir)
    if not items:
        warn("no prompts found")
        return

    count = 0
    for name in items:
        src = skillz_dir / "pi" / "prompts" / f"{name}.md"
        if not src.is_file():
            warn(f"prompt not found: {name}")
            continue

        dst = prompts_dst / f"{name}.md"
        if sync_file(src, dst, "prompt"):
            count += 1

    log(f"  {Colors.BOLD}{count}{Colors.NC} prompt(s) synced")


# ─── Display Functions ───────────────────────────────────────────────────────


def show_list(skillz_dir: Path) -> None:
    log(f"{Colors.BOLD}Available extensions:{Colors.NC}")
    extensions = list_extensions(skillz_dir)
    if not extensions:
        log("  (none)")
    else:
        for ext in extensions:
            log(f"  - {ext}")

    print()

    log(f"{Colors.BOLD}Available skills:{Colors.NC}")
    skills = list_skills(skillz_dir)
    if not skills:
        log("  (none)")
    else:
        current_collection = None
        for skill in skills:
            if "/" in skill:
                collection, name = skill.split("/", 1)
                if collection != current_collection:
                    current_collection = collection
                    log(f"  {Colors.BOLD}{collection}/{Colors.NC}")
                log(f"    - {name}")
            else:
                current_collection = None
                log(f"  - {skill}")

    print()

    log(f"{Colors.BOLD}Available agents:{Colors.NC}")
    agents = list_agents(skillz_dir)
    if not agents:
        log("  (none)")
    else:
        for agent in agents:
            log(f"  - {agent}")

    print()

    log(f"{Colors.BOLD}Available prompts:{Colors.NC}")
    prompts = list_prompts(skillz_dir)
    if not prompts:
        log("  (none)")
    else:
        for prompt in prompts:
            log(f"  - {prompt}")

    print()

    log(f"{Colors.BOLD}Available config:{Colors.NC}")
    pi_dir = skillz_dir / "pi"
    has_config = False
    for name in ("AGENTS.md", "SYSTEM.md"):
        if (pi_dir / name).is_file():
            log(f"  - {name}")
            has_config = True
    if not has_config:
        log("  (none)")

    print()

    log(f"{Colors.BOLD}Available themes:{Colors.NC}")
    themes = list_themes(skillz_dir)
    if not themes:
        log("  (none)")
    else:
        for theme in themes:
            log(f"  - {theme}")


def _is_synced_collection(path: Path) -> bool:
    """Check if a synced directory is a collection (contains sub-skill dirs, not a symlink)."""
    if path.is_symlink():
        return False
    return any(child.is_dir() or child.is_symlink() for child in path.iterdir())


def show_status(agent_dir: Path) -> None:
    C = Colors

    # Extensions
    log(f"{C.BOLD}Synced extensions:{C.NC} ({agent_dir}/extensions/)")
    ext_dir = agent_dir / "extensions"
    if ext_dir.is_dir():
        found = False
        for f in sorted(ext_dir.iterdir()):
            if f.suffix == ".ts" and not f.name.endswith(".d.ts"):
                found = True
                if f.is_symlink():
                    log(f"  {C.GREEN}{f.name}{C.NC} -> {os.readlink(f)}")
                else:
                    log(f"  {C.BLUE}{f.name}{C.NC} (copied)")
            elif f.is_dir() or (f.is_symlink() and not f.suffix):
                found = True
                name = f.name
                if f.is_symlink():
                    log(f"  {C.GREEN}{name}/{C.NC} -> {os.readlink(f)}")
                else:
                    log(f"  {C.BLUE}{name}/{C.NC} (copied)")
        if not found:
            log("  (none)")
    else:
        log("  (directory not found)")

    print()

    # Skills
    log(f"{C.BOLD}Synced skills:{C.NC} ({agent_dir}/skills/)")
    skills_dir = agent_dir / "skills"
    if skills_dir.is_dir():
        found = False
        for d in sorted(skills_dir.iterdir()):
            if not d.is_dir() and not d.is_symlink():
                continue
            found = True
            name = d.name
            if d.is_symlink():
                log(f"  {C.GREEN}{name}{C.NC} -> {os.readlink(d)}")
            elif _is_synced_collection(d):
                # Collection directory — show sub-skills
                log(f"  {C.BOLD}{name}/{C.NC}")
                for sub in sorted(d.iterdir()):
                    if not sub.is_dir() and not sub.is_symlink():
                        continue
                    if sub.is_symlink():
                        log(f"    {C.GREEN}{sub.name}{C.NC} -> {os.readlink(sub)}")
                    else:
                        log(f"    {C.BLUE}{sub.name}{C.NC} (copied)")
            else:
                log(f"  {C.BLUE}{name}{C.NC} (copied)")
        if not found:
            log("  (none)")
    else:
        log("  (directory not found)")

    print()

    # Config
    log(f"{C.BOLD}Synced config:{C.NC} ({agent_dir}/)")
    has_config = False
    for name in ("AGENTS.md", "SYSTEM.md"):
        f = agent_dir / name
        if f.exists() or f.is_symlink():
            has_config = True
            if f.is_symlink():
                log(f"  {C.GREEN}{name}{C.NC} -> {os.readlink(f)}")
            else:
                log(f"  {C.BLUE}{name}{C.NC} (copied)")
    if not has_config:
        log("  (none)")

    print()

    # Agents
    log(f"{C.BOLD}Synced agents:{C.NC} ({agent_dir}/agents/)")
    agents_dir = agent_dir / "agents"
    if agents_dir.is_dir():
        found = False
        for f in sorted(agents_dir.iterdir()):
            if f.suffix != ".md":
                continue
            found = True
            if f.is_symlink():
                log(f"  {C.GREEN}{f.name}{C.NC} -> {os.readlink(f)}")
            else:
                log(f"  {C.BLUE}{f.name}{C.NC} (copied)")
        if not found:
            log("  (none)")
    else:
        log("  (directory not found)")

    print()

    # Prompts
    log(f"{C.BOLD}Synced prompts:{C.NC} ({agent_dir}/prompts/)")
    prompts_dir = agent_dir / "prompts"
    if prompts_dir.is_dir():
        found = False
        for f in sorted(prompts_dir.iterdir()):
            if f.suffix != ".md":
                continue
            found = True
            if f.is_symlink():
                log(f"  {C.GREEN}{f.name}{C.NC} -> {os.readlink(f)}")
            else:
                log(f"  {C.BLUE}{f.name}{C.NC} (copied)")
        if not found:
            log("  (none)")
    else:
        log("  (directory not found)")

    print()

    # Themes
    log(f"{C.BOLD}Synced themes:{C.NC} ({agent_dir}/themes/)")
    themes_dir = agent_dir / "themes"
    if themes_dir.is_dir():
        found = False
        for f in sorted(themes_dir.iterdir()):
            if f.suffix != ".json":
                continue
            found = True
            if f.is_symlink():
                log(f"  {C.GREEN}{f.name}{C.NC} -> {os.readlink(f)}")
            else:
                log(f"  {C.BLUE}{f.name}{C.NC} (copied)")
        if not found:
            log("  (none)")
    else:
        log("  (directory not found)")


# ─── CLI ─────────────────────────────────────────────────────────────────────


def detect_skillz_dir() -> Path:
    if env := os.environ.get("SKILLZ_DIR"):
        return Path(env).resolve()
    return Path.cwd()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pi-sync",
        description="Sync skillz repository to ~/.pi/agent/",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
examples:
  pi-sync all                     Sync everything
  pi-sync extensions              Sync all extensions
  pi-sync skills pexpect-cli      Sync specific skill
  pi-sync skills superpowers      Sync all superpowers skills
  pi-sync agents                  Sync all agent definitions
  pi-sync prompts                 Sync all workflow prompts
  pi-sync themes catppuccin-mocha Sync specific theme
  pi-sync config                  Sync AGENTS.md and SYSTEM.md
  pi-sync --copy all              Copy instead of symlink
  pi-sync status                  Show current state

environment:
  SKILLZ_DIR      Path to skillz repository (default: auto-detect)
  PI_AGENT_DIR    Path to pi agent config (default: ~/.pi/agent)""",
    )

    parser.add_argument(
        "-c", "--copy", action="store_true", help="Copy files instead of symlinking"
    )
    parser.add_argument(
        "-f", "--force", action="store_true", help="Overwrite existing files"
    )
    parser.add_argument(
        "-n",
        "--dry-run",
        action="store_true",
        help="Show what would be done without doing it",
    )
    parser.add_argument("-q", "--quiet", action="store_true", help="Suppress output")

    sub = parser.add_subparsers(dest="command", metavar="COMMAND")
    sub.add_parser("extensions", help="Sync extensions (all if no names given)")
    sub.add_parser("skills", help="Sync skills (all if no names given)")
    sub.add_parser("agents", help="Sync agent definitions (all if no names given)")
    sub.add_parser("prompts", help="Sync workflow prompts (all if no names given)")
    sub.add_parser("themes", help="Sync themes (all if no names given)")
    sub.add_parser("config", help="Sync config files (AGENTS.md, SYSTEM.md)")
    sub.add_parser("all", help="Sync everything")
    sub.add_parser("list", help="List available items")
    sub.add_parser("status", help="Show what's currently synced")

    # Items can appear after the subcommand
    parser.add_argument("items", nargs="*", default=[], help=argparse.SUPPRESS)

    return parser


def main() -> None:
    global opts

    parser = build_parser()
    args, remaining = parser.parse_known_args()

    # Collect items from both parsed and remaining args
    items: list[str] = args.items + remaining

    if not args.command:
        parser.print_help()
        sys.exit(1)

    opts = SyncOptions(
        use_symlink=not args.copy,
        force=args.force,
        dry_run=args.dry_run,
        quiet=args.quiet,
    )

    skillz_dir = detect_skillz_dir()
    agent_dir = Path(os.environ.get("PI_AGENT_DIR", Path.home() / ".pi" / "agent"))

    if not skillz_dir.is_dir():
        die(f"skillz directory not found: {skillz_dir}")

    cmd = args.command

    if cmd == "extensions":
        sync_extensions(skillz_dir, agent_dir, items)
    elif cmd == "skills":
        sync_skills(skillz_dir, agent_dir, items)
    elif cmd == "agents":
        sync_agents(skillz_dir, agent_dir, items)
    elif cmd == "prompts":
        sync_prompts(skillz_dir, agent_dir, items)
    elif cmd == "themes":
        sync_themes(skillz_dir, agent_dir, items)
    elif cmd == "config":
        sync_config(skillz_dir, agent_dir)
    elif cmd == "all":
        sync_extensions(skillz_dir, agent_dir, [])
        print()
        sync_skills(skillz_dir, agent_dir, [])
        print()
        sync_agents(skillz_dir, agent_dir, [])
        print()
        sync_prompts(skillz_dir, agent_dir, [])
        print()
        sync_themes(skillz_dir, agent_dir, [])
        print()
        sync_config(skillz_dir, agent_dir)
    elif cmd == "list":
        show_list(skillz_dir)
    elif cmd == "status":
        show_status(agent_dir)
