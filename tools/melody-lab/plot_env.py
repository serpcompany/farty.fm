import json, librosa
from pathlib import Path, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from engine import MANIFEST, AUDIO_DIR, SR, note_segment
recs=json.loads(MANIFEST.read_text())['recordings']
fig,axs=plt.subplots(6,4,figsize=(20,18)); axs=axs.ravel()
for ax,r in zip(axs,recs):
    y,_=librosa.load(AUDIO_DIR/r['filename'],sr=SR,mono=True)
    hop=int(0.005*SR); db=20*np.log10(librosa.feature.rms(y=y,frame_length=2*hop,hop_length=hop)[0]+1e-9)
    t=np.arange(len(db))*hop/SR; ax.plot(t,db,lw=0.8); s,e,c=note_segment(y)
    ax.axvline(s/SR,color='g'); ax.axvline(e/SR,color='r'); ax.set_ylim(db.max()-45,db.max()+3); ax.set_title(r['id'])
plt.tight_layout(); Path('out').mkdir(exist_ok=True); plt.savefig('out/envelopes.png',dpi=55)
