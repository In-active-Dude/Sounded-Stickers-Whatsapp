import json, os, queue, subprocess, sys, tempfile, threading, tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk

BASE = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
BIN = BASE / 'bin'
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

class Studio(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('Sound Sticker Studio')
        self.geometry('940x720'); self.minsize(820, 650)
        self.video = None; self.duration = 0; self.box = None; self.anchor = None
        self.draw_rect = None; self.image_ref = None; self.process = None; self.messages = queue.Queue()
        self.configure(bg='#f2f5f4')
        style = ttk.Style(self); style.theme_use('clam')
        style.configure('TButton', padding=8); style.configure('Accent.TButton', padding=10, background='#087e67', foreground='white')
        top = tk.Frame(self,bg='#f2f5f4'); top.pack(fill='x',padx=24,pady=(20,8))
        tk.Label(top,text='Sound Sticker Studio',font=('Segoe UI',22,'bold'),bg='#f2f5f4',fg='#143c34').pack(anchor='w')
        tk.Label(top,text='Turn a short video into a WhatsApp sticker with sound.',font=('Segoe UI',10),bg='#f2f5f4',fg='#52645f').pack(anchor='w')
        body = tk.Frame(self,bg='#f2f5f4'); body.pack(fill='both',expand=True,padx=24,pady=8)
        left = tk.Frame(body,bg='#f2f5f4'); left.pack(side='left',fill='both',expand=True)
        right = tk.Frame(body,bg='#ffffff',padx=18,pady=18,width=295); right.pack(side='right',fill='y',padx=(18,0)); right.pack_propagate(False)
        self.canvas = tk.Canvas(left,width=550,height=390,bg='#172824',highlightthickness=0,cursor='crosshair'); self.canvas.pack(fill='both',expand=True)
        self.canvas.bind('<ButtonPress-1>',self.begin_crop); self.canvas.bind('<B1-Motion>',self.move_crop); self.canvas.bind('<ButtonRelease-1>',self.end_crop)
        self.canvas.bind('<Configure>',lambda e:self.render_preview())
        tk.Label(left,text='Drag over the preview to crop. Reset crop keeps the whole frame.',bg='#f2f5f4',fg='#52645f',font=('Segoe UI',9)).pack(anchor='w',pady=(6,8))
        bar = tk.Frame(left,bg='#f2f5f4'); bar.pack(fill='x')
        ttk.Button(bar,text='Choose video',command=self.choose_video).pack(side='left')
        ttk.Button(bar,text='Reset crop',command=self.reset_crop).pack(side='left',padx=8)
        ttk.Button(bar,text='Update preview',command=self.load_frame).pack(side='left')
        self.filename = tk.Label(left,text='No video selected',bg='#f2f5f4',fg='#52645f',anchor='w',wraplength=550); self.filename.pack(fill='x',pady=8)
        tk.Label(right,text='Clip settings',font=('Segoe UI',15,'bold'),bg='white',fg='#143c34').pack(anchor='w')
        self.start = tk.StringVar(value='0'); self.end = tk.StringVar(value='')
        for label,var in [('Start (seconds)',self.start),('End (seconds)',self.end)]:
            tk.Label(right,text=label,bg='white',fg='#425b54',font=('Segoe UI',10)).pack(anchor='w',pady=(14,4))
            ttk.Entry(right,textvariable=var).pack(fill='x')
        tk.Label(right,text='Choose up to 10 seconds. The video must contain an audio track.',wraplength=245,justify='left',bg='white',fg='#71817d').pack(anchor='w',pady=(10,18))
        self.send_button=ttk.Button(right,text='Create and send sticker',style='Accent.TButton',command=self.send); self.send_button.pack(fill='x')
        self.status=tk.Label(right,text='Choose a video to begin.',wraplength=245,justify='left',anchor='w',bg='white',fg='#425b54',font=('Segoe UI',10)); self.status.pack(fill='x',pady=(18,5))
        self.qr_label=tk.Label(right,bg='white'); self.qr_label.pack(pady=5)
        tk.Label(right,text='First use: scan the QR code with WhatsApp → Linked devices. This uses an unofficial linked client.',wraplength=245,justify='left',bg='white',fg='#71817d').pack(side='bottom',anchor='w')
        self.protocol('WM_DELETE_WINDOW',self.close); self.after(100,self.poll)

    def choose_video(self):
        file=filedialog.askopenfilename(filetypes=[('Video files','*.mp4 *.mov *.mkv *.webm *.avi'),('All files','*.*')])
        if not file:return
        try:
            r=subprocess.run([str(BIN/'ffprobe.exe'),'-v','error','-show_entries','format=duration:stream=codec_type','-of','json',file],capture_output=True,text=True,creationflags=NO_WINDOW,check=True)
            info=json.loads(r.stdout); duration=float(info['format']['duration'])
            types={s['codec_type'] for s in info['streams']}
            if 'video' not in types or 'audio' not in types or duration <= 0: raise ValueError('Choose a video that contains an audio track.')
            self.video=file; self.duration=duration; self.start.set('0'); self.end.set(f'{min(duration,10):.2f}'); self.box=None
            self.filename.config(text=Path(file).name + f'  ·  {duration:.1f} seconds'); self.load_frame()
        except Exception as e: messagebox.showerror('Could not open video',str(e))

    def load_frame(self):
        if not self.video:return
        try:
            start=float(self.start.get())
            if not 0 <= start < self.duration: raise ValueError('Start time must be inside the video.')
            r=subprocess.run([str(BIN/'ffmpeg.exe'),'-hide_banner','-loglevel','error','-ss',str(start),'-i',self.video,'-frames:v','1','-f','image2pipe','-vcodec','png','-'],capture_output=True,creationflags=NO_WINDOW,check=True)
            from io import BytesIO
            self.frame=Image.open(BytesIO(r.stdout)).convert('RGB'); self.render_preview()
        except Exception as e: messagebox.showerror('Preview unavailable',str(e))

    def render_preview(self):
        if not hasattr(self,'frame'):return
        w=max(1,self.canvas.winfo_width()); h=max(1,self.canvas.winfo_height())
        image=self.frame.copy(); image.thumbnail((w,h),Image.Resampling.LANCZOS)
        self.display=(int((w-image.width)/2),int((h-image.height)/2),image.width,image.height)
        self.image_ref=ImageTk.PhotoImage(image); self.canvas.delete('all'); self.canvas.create_image(self.display[0],self.display[1],anchor='nw',image=self.image_ref)
        if self.box:
            x,y,bw,bh=self.box; ox,oy,iw,ih=self.display
            self.canvas.create_rectangle(ox+x*iw,oy+y*ih,ox+(x+bw)*iw,oy+(y+bh)*ih,outline='#45e0ad',width=3)

    def point(self,event):
        if not hasattr(self,'display'):return None
        ox,oy,w,h=self.display
        return (max(0,min(1,(event.x-ox)/w)),max(0,min(1,(event.y-oy)/h)))
    def begin_crop(self,e): self.anchor=self.point(e)
    def move_crop(self,e):
        p=self.point(e)
        if self.anchor and p:
            x,y=self.anchor; self.box=(min(x,p[0]),min(y,p[1]),abs(x-p[0]),abs(y-p[1])); self.render_preview()
    def end_crop(self,e):
        self.move_crop(e); self.anchor=None
        if self.box and (self.box[2] < .02 or self.box[3] < .02): self.box=None; self.render_preview()
    def reset_crop(self): self.box=None; self.render_preview()

    def send(self):
        if not self.video: messagebox.showinfo('Choose a video','Select a video first.'); return
        try:
            start=float(self.start.get()); end=float(self.end.get())
            if not 0 <= start < end <= self.duration + .02 or end-start > 10.001: raise ValueError('Select a valid clip of up to 10 seconds.')
        except ValueError as e: messagebox.showerror('Check clip times',str(e)); return
        x,y,w,h=self.box or (0,0,1,1)
        cfg={'video':self.video,'start':start,'duration':min(end,self.duration)-start,'crop':{'x':x,'y':y,'w':w,'h':h},'sessionDir':str(BASE/'whatsapp_session')}
        self.send_button.config(state='disabled'); self.qr_label.config(image=''); self.status.config(text='Starting…')
        threading.Thread(target=self.worker,args=(cfg,),daemon=True).start()

    def worker(self,cfg):
        name=None; terminal_event=False
        try:
            with tempfile.NamedTemporaryFile('w',encoding='utf-8',suffix='.json',delete=False) as f: json.dump(cfg,f); name=f.name
            self.process=subprocess.Popen([str(BIN/'node.exe'),str(BASE/'backend.cjs'),name],cwd=str(BASE),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',creationflags=NO_WINDOW)
            for line in self.process.stdout:
                if line.startswith('APP_EVENT:'):
                    try:
                        event=json.loads(line[len('APP_EVENT:'):]); self.messages.put(event)
                        if event.get('kind') in ('done','error'): terminal_event=True
                    except json.JSONDecodeError:pass
            code=self.process.wait()
            if code and not terminal_event: self.messages.put({'kind':'exit','data':'The sender stopped. Check your connection and try again.'})
        except Exception as e:self.messages.put({'kind':'error','data':str(e)})
        finally:
            if name:
                try:os.unlink(name)
                except OSError:pass
            self.process=None

    def poll(self):
        try:
            while True:
                event=self.messages.get_nowait(); kind=event.get('kind'); data=event.get('data')
                if kind=='qr':
                    n=len(data); im=Image.new('RGB',(n+8,n+8),'white'); p=im.load()
                    for y,row in enumerate(data):
                        for x,value in enumerate(row):
                            if value:p[x+4,y+4]=(0,0,0)
                    im=im.resize((240,240),Image.Resampling.NEAREST); self.qr_ref=ImageTk.PhotoImage(im); self.qr_label.config(image=self.qr_ref)
                    self.status.config(text='Scan this code in WhatsApp → Linked devices.');
                elif kind in ('status','done','error','exit'):
                    self.status.config(text=data)
                    if kind in ('done','error','exit'): self.send_button.config(state='normal'); self.qr_label.config(image='')
        except queue.Empty:pass
        self.after(100,self.poll)
    def close(self):
        if self.process and self.process.poll() is None:
            if not messagebox.askyesno('Cancel sticker?','A sticker is still being prepared or sent. Close anyway?'):return
            self.process.terminate()
        self.destroy()

if __name__=='__main__': Studio().mainloop()
