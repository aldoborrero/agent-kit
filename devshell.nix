{
  pkgs,
}:
pkgs.mkShellNoCC {
  packages = [
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
