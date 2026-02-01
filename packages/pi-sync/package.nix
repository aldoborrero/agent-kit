{
  lib,
  python3,
  nodejs,
}:
python3.pkgs.buildPythonApplication {
  pname = "pi-sync";
  version = "0.2.0";
  pyproject = true;

  src = ./.;

  build-system = with python3.pkgs; [
    setuptools
    wheel
  ];

  makeWrapperArgs = [ "--prefix PATH : ${lib.makeBinPath [ nodejs ]}" ];

  pythonImportsCheck = [ "pi_sync" ];

  meta = {
    description = "Sync skillz extensions and skills to ~/.pi/agent/";
    mainProgram = "pi-sync";
  };
}
