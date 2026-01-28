{
  lib,
  stdenvNoCC,
  makeWrapper,
  coreutils,
  findutils,
  gnused,
}:
stdenvNoCC.mkDerivation {
  pname = "pi-sync";
  version = "0.1.0";

  src = ./.;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    install -Dm755 pi-sync $out/bin/pi-sync

    wrapProgram $out/bin/pi-sync \
      --prefix PATH : ${
        lib.makeBinPath [
          coreutils
          findutils
          gnused
        ]
      }

    runHook postInstall
  '';

  meta = {
    description = "Sync skillz extensions and skills to ~/.pi/agent/";
    mainProgram = "pi-sync";
  };
}
