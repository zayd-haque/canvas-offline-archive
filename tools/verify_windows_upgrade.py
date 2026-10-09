"""Real Windows release upgrade with disposable settings, course and environment."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

assert sys.platform == 'win32'
REPO = 'https://api.github.com/repos/zayd-haque/canvas-offline-archive/releases'
def get(url):
    request = urllib.request.Request(url, headers={'User-Agent':'Canvas-Windows-Upgrade-Verification'})
    with urllib.request.urlopen(request, timeout=60) as response: return response.read()

with tempfile.TemporaryDirectory(prefix='canvas-upgrade-') as temporary:
    root = Path(temporary)
    metadata = json.loads(get(REPO + '/tags/v1.0.7'))
    asset = next(a for a in metadata['assets'] if a['name']=='canvas-offline-archive-windows.zip')
    archive = root / 'old.zip'; archive.write_bytes(get(asset['browser_download_url']))
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == asset['digest'].split(':')[1]
    with zipfile.ZipFile(archive) as zipped: zipped.extractall(root / 'Install With Spaces')
    app = root / 'Install With Spaces' / 'canvas-offline-archive'
    home = root / 'Home'; home.mkdir()
    course = root / 'Archives' / 'Synthetic Course'; course.mkdir(parents=True)
    (course / 'notes.txt').write_text('Private synthetic course sentinel 78231', encoding='utf-8')
    (course / 'canvas_course.json').write_text(json.dumps({'course_name':'Synthetic Course','course_url':'https://canvas.example/courses/123','file_path_map':{'notes.txt':['notes.txt']}}),encoding='utf-8')
    config = app / 'Canvas Module Downloader' / 'config.json'
    config.write_text(json.dumps({'search_dirs':[str(course)],'default_course_dir':str(course.parent),'ai_provider':'rules','gemini_tier':'free','disk_hierarchy':[]}),encoding='utf-8')
    sentinels = {config:config.read_bytes(),course/'notes.txt':(course/'notes.txt').read_bytes(),course/'canvas_course.json':(course/'canvas_course.json').read_bytes()}
    env = os.environ.copy(); env.update(HOME=str(home),USERPROFILE=str(home),CANVAS_CACHE_DIR=str(root/'Cache'),PYTHONIOENCODING='utf-8',CANVAS_OFFLINE_NO_UPDATE='1')
    cmd = app / 'Open Canvas Offline Archive Windows.cmd'
    subprocess.run([os.environ['COMSPEC'],'/d','/c',str(cmd),'--setup-only'],cwd=app,env=env,check=True,timeout=600)
    python = app / '.venv' / 'Scripts' / 'python.exe'
    marker = app / '.venv' / 'preserve-sentinel.txt'; marker.write_text('keep')

    def launch_and_check(label):
        url_file = root / 'browser-url.txt'; url_file.unlink(missing_ok=True)
        harness = root / 'launch.py'
        harness.write_text('import sys,webbrowser\nfrom pathlib import Path\nsys.path.insert(0,'+repr(str(app/'canvas_app'))+')\nwebbrowser.open=lambda url: Path('+repr(str(url_file))+').write_text(url)\nimport run\nrun.main()\n')
        log = root / (label+'.log')
        with log.open('wb') as output:
            proc = subprocess.Popen([str(python),str(harness)],cwd=app,env=env,stdout=output,stderr=subprocess.STDOUT)
            try:
                deadline=time.monotonic()+60
                while not url_file.exists():
                    assert proc.poll() is None, log.read_text(encoding='utf-8',errors='replace')
                    assert time.monotonic()<deadline,'Startup timeout'
                    time.sleep(.25)
                token=url_file.read_text().split('#bootstrap=')[1]
                request=urllib.request.Request('http://127.0.0.1:8000/api/auth/session',data=json.dumps({'token':token}).encode(),headers={'Origin':'http://127.0.0.1:8000','Content-Type':'application/json'})
                with urllib.request.urlopen(request) as response: cookie=response.headers['Set-Cookie'].split(';')[0]
                request=urllib.request.Request('http://127.0.0.1:8000/api/courses',headers={'Cookie':cookie})
                with urllib.request.urlopen(request) as response: courses=json.load(response)['courses']
                assert any(c['name']=='Synthetic Course' for c in courses),courses
                print(label+'_STARTUP_AND_COURSE_ACCESS_PASS')
            finally:
                proc.terminate(); proc.wait(timeout=20)
    launch_and_check('BEFORE_UPGRADE')
    env.pop('CANVAS_OFFLINE_NO_UPDATE')
    subprocess.run([os.environ['COMSPEC'],'/d','/c',str(cmd),'--setup-only'],cwd=app,env=env,check=True,timeout=600)
    assert json.loads((app/'release_info.json').read_text())['tag']=='v1.0.8'
    for path,expected in sentinels.items(): assert path.read_bytes()==expected,str(path)
    assert marker.read_text()=='keep'
    assert (app/'canvas_app'/'ocr_windows.py').is_file()
    subprocess.run([str(python),'-c','from winrt.windows.media.ocr import OcrEngine; import pypdfium2'],check=True,env=env)
    env['CANVAS_OFFLINE_NO_UPDATE']='1'
    launch_and_check('AFTER_UPGRADE')
    print('WINDOWS_V107_TO_V108_LAUNCHER_UPGRADE_SETTINGS_COURSE_VENV_PASS')
