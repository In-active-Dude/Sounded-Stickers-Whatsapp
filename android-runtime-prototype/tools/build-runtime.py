"""Build the Android Node asset from the previous runtime and current sender."""
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
source = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'app/src/main/assets/runtime-v8.zip'
destination = root / 'app/src/main/assets/runtime-v8.zip'
temporary = destination.with_suffix('.building')
replaced = {'sender.cjs', 'job-cleanup.cjs', 'smoke.cjs'}

def keep(name):
    lower = name.lower()
    return (name not in replaced and not name.startswith('node_modules/@img/sharp-win32-x64/')
            and not lower.endswith(('.dll', '.exe', '.node', '.map', '.d.ts')))

with zipfile.ZipFile(source) as previous, zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as result:
    for item in previous.infolist():
        if keep(item.filename):
            result.writestr(item, previous.read(item))
    for name in ('sender.cjs', 'job-cleanup.cjs'):
        result.write(root / name, name)
temporary.replace(destination)
print(f'Created {destination.name}: {destination.stat().st_size} bytes')
