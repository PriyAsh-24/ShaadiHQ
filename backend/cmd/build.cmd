@echo off
setlocal

rem Build the API from the backend module, regardless of the caller's directory.
pushd "%~dp0.."
if errorlevel 1 (
    echo ERROR: Could not open the backend directory.
    exit /b 1
)

go build -buildvcs=false -o "%~dp0shaadi_hq.exe" .
if errorlevel 1 (
    echo ERROR: Backend build failed.
    popd
    exit /b 1
)

popd
echo Built "%~dp0shaadi_hq.exe"
endlocal
