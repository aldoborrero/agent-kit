{
  pkgs,
  perSystem,
}:
pkgs.mkShellNoCC {
  packages = [
    pkgs.datasette
    pkgs.python3
    pkgs.sqlite
    pkgs.sqlite-web
    perSystem.self.pi-sync
  ];
  shellHook = ''
    export PRJ_ROOT=$PWD
  '';
}
