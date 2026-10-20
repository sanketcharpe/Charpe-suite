"""Called by 'Install Charpe Helper.bat': copies the helper, makes it start with Windows, starts it now."""
import os, shutil, subprocess, sys, time, webbrowser

here = os.path.dirname(os.path.abspath(__file__))
dest = os.path.join(os.environ["APPDATA"], "CharpeHelper")
os.makedirs(dest, exist_ok=True)
target = os.path.join(dest, "charpe-helper.pyw")
shutil.copyfile(os.path.join(here, "charpe-helper.pyw"), target)
print("  2/4  Helper copied to", dest)

pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
if not os.path.exists(pyw):
    pyw = sys.executable
startup = os.path.join(os.environ["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
os.makedirs(startup, exist_ok=True)
with open(os.path.join(startup, "Charpe Helper.vbs"), "w") as f:
    f.write('Set s = CreateObject("WScript.Shell")\r\n')
    f.write('s.Run """%s"" ""%s""", 0, False\r\n' % (pyw, target))
print("  3/4  Set to start with Windows")

subprocess.Popen([pyw, target], creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0), close_fds=True)
time.sleep(4)
webbrowser.open("http://127.0.0.1:8770/")
print("  4/4  Started")
