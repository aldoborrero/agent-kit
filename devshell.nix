{
  pkgs,
  perSystem,
}:
pkgs.mkShellNoCC {
  packages = [
    perSystem.self.pi-sync
    pkgs.bun
    pkgs.datasette
    pkgs.python3
    pkgs.sqlite
    pkgs.sqlite-web
  ];
  shellHook = ''
    export PRJ_ROOT=$PWD
  '';
}
