{
  pkgs,
  perSystem,
}:
pkgs.mkShellNoCC {
  packages = [
    perSystem.self.pi-sync
  ];
  shellHook = ''
    export PRJ_ROOT=$PWD
  '';
}
