{ python3 }:
python3.pkgs.buildPythonApplication {
  pname = "searxng-search";
  version = "0.1.0";
  pyproject = true;

  src = ./.;

  build-system = with python3.pkgs; [
    setuptools
    wheel
  ];

  nativeCheckInputs = with python3.pkgs; [
    mypy
    pytestCheckHook
  ];

  preCheck = ''
    mypy searxng_search
  '';

  pythonImportsCheck = [ "searxng_search" ];

  meta = {
    description = "CLI for querying SearXNG instances with LLM-friendly output";
    mainProgram = "searxng-search";
  };
}
