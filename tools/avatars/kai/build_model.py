# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Kai study 01 — editable procedural sculpture, not a biometric reconstruction.

Run: python build_model.py --output DIRECTORY
Dependencies: numpy, scipy, trimesh. Z-up authoring; Y-up glTF export.
Third companion to the Sky and Dasha studies: same helper library, same export
contract, same skeleton. The figure reads androgynous by construction — the
shoulder-to-hip ratio sits between the two earlier studies, the torso is
straight, and no feature is exaggerated toward either of them. It is an
artistic study, not a claim about any person's body, gender or presentation.
"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rig import Landmarks, export_avatar
LANDMARKS = Landmarks()
import argparse
import numpy as np
from scipy.interpolate import PchipInterpolator, CubicSpline
import trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

parser=argparse.ArgumentParser(); parser.add_argument('--output',default='../kai-3d-output'); args=parser.parse_args()
OUT=Path(args.output).resolve(); OUT.mkdir(parents=True,exist_ok=True)
PARTS=[]
PALETTE={
 'skin':('#d3a389',.66,0), 'skin_shadow':('#b17f6b',.73,0),
 'lip':('#a2645f',.49,0), 'lip_dark':('#75433f',.65,0),
 'brow':('#4f4034',.82,0), 'eye_white':('#ece6dc',.34,0),
 'iris':('#6f7f80',.40,0), 'iris_edge':('#44514f',.48,0), 'pupil':('#161a1a',.24,0),
 'hair':('#3f3a36',.62,0), 'hair_light':('#59524a',.58,0), 'hair_fade':('#33302d',.70,0),
 'overshirt':('#9aa891',.86,0), 'overshirt_shadow':('#82927a',.88,0),
 'tee':('#efece3',.90,0), 'tee_shadow':('#d6d2c7',.92,0),
 'trouser':('#6b727b',.90,0), 'trouser_shadow':('#585e66',.92,0),
 'boot':('#3b3630',.52,0), 'boot_sole':('#211e1b',.78,0),
 'silver':('#c0c5c8',.24,.86), 'cord':('#2f332f',.88,0)
}
def rgb(h): return [int(h[i:i+2],16) for i in (1,3,5)]
MATERIALS={k:PBRMaterial(name=k,baseColorFactor=rgb(v[0])+[255],roughnessFactor=v[1],metallicFactor=v[2],doubleSided=True) for k,v in PALETTE.items()}

def add(name,verts,faces,mat,group='body'):
    m=trimesh.Trimesh(vertices=np.asarray(verts),faces=np.asarray(faces),process=True)
    m.fix_normals()
    m.visual=TextureVisuals(material=MATERIALS[mat])
    m.metadata={'name':name,'group':group,'material':mat}
    PARTS.append((name,m,mat,group));return m

def grid_mesh(name,grid,mat,wrap=False,group='body',reverse=False):
    g=np.asarray(grid);n,m=g.shape[:2];faces=[]
    for i in range(n-1):
      for j in range(m if wrap else m-1):
        k=(j+1)%m;a=i*m+j;b=i*m+k;c=(i+1)*m+k;d=(i+1)*m+j
        faces.extend([[a,b,c],[a,c,d]])
    if reverse:faces=[f[::-1] for f in faces]
    return add(name,g.reshape(-1,3),faces,mat,group)

def ellipsoid(name,center,scale,mat,group='body',rotation=None):
    m=trimesh.creation.uv_sphere(count=[28,40]);m.vertices*=scale
    if rotation is not None:m.apply_transform(rotation)
    m.vertices+=center
    return add(name,m.vertices,m.faces,mat,group)

def interp_path(points,n=50):
    p=np.asarray(points,float);t=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))];t/=t[-1]
    return CubicSpline(t,p,axis=0)(np.linspace(0,1,n))

def tube(name,points,radii,mat,n=45,sides=20,group='body',elliptic=1):
    LANDMARKS.tube(name, points)
    path=interp_path(points,n);tang=np.gradient(path,axis=0);tang/=np.linalg.norm(tang,axis=1)[:,None]
    rr=np.interp(np.linspace(0,1,n),np.linspace(0,1,len(radii)),radii);grid=[]
    for p,t,r in zip(path,tang,rr):
      v=np.cross(t,[0,1,0])
      if np.linalg.norm(v)<.01:v=np.cross(t,[1,0,0])
      v/=np.linalg.norm(v);w=np.cross(t,v)
      grid.append([p+r*(np.cos(a)*v+elliptic*np.sin(a)*w) for a in np.linspace(0,2*np.pi,sides,endpoint=False)])
    return grid_mesh(name,grid,mat,True,group)

def loft(name,sections,mat,rings=70,sides=96,group='body',gap=None):
    # sections: z, radius x, radius y, center x, center y
    LANDMARKS.loft(name, sections)
    sec=np.array(sections);z=np.linspace(sec[0,0],sec[-1,0],rings)
    vals=PchipInterpolator(sec[:,0],sec[:,1:],axis=0)(z);grid=[]
    for zz,(rx,ry,cx,cy) in zip(z,vals):
      alpha=0 if gap is None else gap(zz)
      theta=np.linspace(alpha,2*np.pi-alpha,sides,endpoint=gap is not None)
      grid.append([[cx+rx*np.sin(a),cy-ry*np.cos(a),zz] for a in theta])
    return grid_mesh(name,grid,mat,gap is None,group)

def strip(name,points,widths,depth,mat,normal=(0,-1,0),n=55,group='hair',sides=10):
    path=interp_path(points,n);tt=np.gradient(path,axis=0);tt/=np.linalg.norm(tt,axis=1)[:,None]
    widths=np.interp(np.linspace(0,1,n),np.linspace(0,1,len(widths)),widths);grid=[]
    for p,t,w in zip(path,tt,widths):
      nn=np.asarray(normal,float);u=np.cross(t,nn)
      if np.linalg.norm(u)<1e-4:u=np.cross(t,[1,0,0])
      u/=np.linalg.norm(u);nn=np.cross(u,t);nn/=np.linalg.norm(nn)
      grid.append([p+u*w*.5*np.cos(a)+nn*depth*np.sin(a) for a in np.linspace(0,2*np.pi,sides,endpoint=False)])
    return grid_mesh(name,grid,mat,True,group,reverse=True)

def surf_pt(sections,z,a,push=.0):
    sec=np.array(sections);rx,ry,cx,cy=PchipInterpolator(sec[:,0],sec[:,1:],axis=0)(z)
    return [cx+(rx+push)*np.sin(a),cy-(ry+push)*np.cos(a),z]

def panel(name,verts,mat,group='clothing',thickness=.0025):
    v=np.asarray(verts,float);c=v.mean(axis=0);front=np.vstack([c,v]);back=front+[0,thickness,0]
    n=len(v);faces=[]
    for i in range(n):
      a=i+1;b=(i+1)%n+1
      faces.extend([[0,a,b],[n+1,n+1+b,n+1+a],[a,n+1+a,n+1+b],[a,n+1+b,b]])
    return add(name,np.vstack([front,back]),faces,mat,group)

# ---------------------------------------------------------------- footwear
# Low leather boots. Both feet carry weight evenly; the two sides differ only
# by their stance offsets, so neither leg reads as the planted one.
for side,cx,cy in [('L',-.088,.010),('R',.094,-.028)]:
    loft(side+'_boot_sole',[(.004,.047,.120,cx,cy-.040),(.010,.052,.129,cx,cy-.043),(.018,.053,.131,cx,cy-.045),(.026,.052,.128,cx,cy-.045)],'boot_sole',16,64,'shoes')
    loft(side+'_boot_upper',[(.025,.052,.128,cx,cy-.045),(.046,.053,.130,cx,cy-.046),(.074,.052,.124,cx,cy-.044),(.104,.049,.100,cx,cy-.024),(.132,.046,.068,cx,cy+.004),(.156,.045,.056,cx,cy+.010)],'boot',44,64,'shoes')
    tube(side+'_boot_rim',[[cx+.045*np.sin(a),cy+.010-.056*np.cos(a),.158] for a in np.linspace(0,2*np.pi,20)],[.0038,.0038],'boot',60,10,'shoes')
    for k,(zz,yy,ww) in enumerate([(.140,-.052,.024),(.120,-.064,.021)]):
      tube(side+f'_boot_lace_{k}',[[cx-ww,cy+yy+.006,zz-.004],[cx,cy+yy-.005,zz],[cx+ww,cy+yy+.006,zz-.004]],[.0021,.0025,.0021],'cord',24,8,'shoes')
    ellipsoid(side+'_boot_pull',[cx,cy+.052,.150],[.014,.006,.010],'boot','shoes')

# ---------------------------------------------------------------- trousers
# Wide, flat-front trousers with a soft break over the boot. The straight
# thigh and the unshaped seat are what keep the silhouette neutral.
for side,cx,cy in [('L',-.088,.010),('R',.094,-.028)]:
    LEG=[(.146,.058,.060,cx,cy),(.210,.064,.066,cx,cy),(.340,.070,.073,cx,cy),(.530,.078,.081,cx,cy+.002),(.710,.086,.089,cx*.95,cy+.004),(.870,.092,.094,cx*.90,cy+.008),(.950,.096,.095,cx*.78,cy*.5+.006),(1.014,.097,.090,cx*.54,cy*.3+.006),(1.046,.091,.084,cx*.40,cy*.2+.006)]
    loft(side+'_leg',LEG,'trouser',62,72,'clothing')
    loft(side+'_trouser_break',[(.150,.058,.060,cx,cy),(.176,.063,.065,cx,cy),(.206,.062,.064,cx,cy),(.226,.057,.059,cx,cy)],'trouser_shadow',18,64,'clothing')
    for tag,ang,zs in [('a',-.58,(.300,.480,.690)),('b',.60,(.360,.560,.780))]:
      pts=[surf_pt(LEG,z,ang+.08*np.sin(i*1.9),-.0016) for i,z in enumerate(zs)]
      tube(side+'_trouser_fold_'+tag,pts,[.0012,.0023,.0011],'trouser_shadow',34,8,'clothing')
    sgn=-1 if side=='L' else 1
    pts=[surf_pt(LEG,z,sgn*np.pi/2,-.0012) for z in (.240,.580,.910)]
    tube(side+'_trouser_seam',pts,[.0009,.0011,.0009],'trouser_shadow',40,6,'clothing')
    pts=[surf_pt(LEG,z,0,-.0014) for z in (.520,.760,.980)]
    tube(side+'_trouser_crease',pts,[.0009,.0013,.0010],'trouser_shadow',36,6,'clothing')

# ---------------------------------------------------------------- neck
loft('neck',[(1.420,.076,.059,0,.006),(1.474,.056,.049,0,.008),(1.540,.048,.045,0,.008),(1.594,.054,.046,0,.008),(1.646,.065,.051,0,.008)],'skin',54,64,'head')

# ---------------------------------------------------------------- torso
# An open overshirt over a plain tee. The shell is straight from hem to
# shoulder: no waist suppression, no chest shaping, no shoulder padding.
TEE=[(1.052,.152,.099,0,0),(1.140,.156,.101,0,.001),(1.260,.160,.103,0,.002),(1.360,.166,.106,0,.004),(1.436,.170,.104,0,.006),(1.486,.160,.094,0,.007),(1.516,.104,.066,0,.008),(1.528,.076,.055,0,.008)]
loft('tee_shell',TEE,'tee',88,96,'clothing')
loft('tee_collar',[(1.500,.078,.058,0,.008),(1.520,.070,.053,0,.008),(1.534,.066,.050,0,.008)],'tee_shadow',14,64,'clothing')
for s,label in [(-1,'L'),(1,'R')]:
    pts=[surf_pt(TEE,z,s*a,-.0012) for z,a in [(1.420,.90),(1.320,1.05),(1.210,.95)]]
    tube(label+'_tee_fold',pts,[.0010,.0020,.0009],'tee_shadow',34,8,'clothing')

coat=[(.986,.176,.112,0,0),(1.010,.182,.115,0,0),(1.120,.181,.114,0,0),(1.240,.182,.114,0,.001),
      (1.344,.186,.115,0,.003),(1.428,.190,.113,0,.005),(1.482,.184,.102,0,.007),
      (1.510,.168,.088,0,.008),(1.532,.096,.063,0,.008),(1.542,.071,.053,0,.008)]
# The shell is open at the front: the gap widens from collar to hem, so the
# tee reads through the opening instead of the shell closing over it.
loft('overshirt_shell',coat,'overshirt',96,104,'clothing',gap=lambda z:float(np.interp(z,[.986,1.240,1.500,1.542],[.46,.36,.18,.06])))
loft('overshirt_hem',[(.978,.174,.111,0,0),(.990,.180,.114,0,0),(1.006,.181,.114,0,0),(1.018,.176,.111,0,0)],'overshirt_shadow',18,88,'clothing',gap=lambda z:.46)
loft('overshirt_collar',[(1.502,.088,.061,0,.008),(1.524,.077,.056,0,.008),(1.548,.072,.053,0,.008),(1.558,.069,.051,0,.008)],'overshirt',18,72,'clothing',gap=lambda z:.10)
loft('overshirt_stand',[(1.508,.071,.052,0,.008),(1.546,.065,.048,0,.008),(1.556,.063,.047,0,.008)],'overshirt_shadow',14,64,'clothing',gap=lambda z:.12)

# Front placket edges and two patch pockets: the only structure on the shell.
for s,label in [(-1,'L'),(1,'R')]:
    edge=[surf_pt(coat,z,s*float(np.interp(z,[.986,1.240,1.500,1.542],[.46,.36,.18,.06])),-.0012) for z in (1.000,1.150,1.300,1.430,1.520)]
    strip(label+'_placket',edge,[.016,.019,.020,.019,.014],.0028,'overshirt_shadow',(0,-1,0),46,'clothing',10)
    welt=[surf_pt(coat,z,s*a,-.0014) for z,a in [(1.150,.98),(1.128,.74),(1.116,.50)]]
    tube(label+'_pocket_welt',welt,[.0018,.0028,.0015],'overshirt_shadow',34,8,'clothing')
    seam=[surf_pt(coat,z,s*a,-.0010) for z,a in [(1.412,1.06),(1.300,1.18),(1.190,1.06)]]
    tube(label+'_shell_fold',seam,[.0010,.0021,.0009],'overshirt_shadow',36,8,'clothing')

# ---------------------------------------------------------------- arms
# Arms hang beside the hem, elbows soft. The sleeve is the arm landmark, so
# the rig reads the same chain here as in the other two studies.
for s,label in [(-1,'L'),(1,'R')]:
    shoulder=[s*.152,.006,1.418]; elbow=[s*.212,-.008,1.226]
    wrist=np.array([s*.206,-.032,1.008])
    tube(label+'_sleeve',[shoulder,[s*.192,.002,1.326],elbow,[s*.208,-.024,1.102],wrist],[.053,.062,.057,.048,.042],'overshirt',68,44,'clothing',.97)
    ellipsoid(label+'_shoulder_cap',[s*.168,.006,1.420],[.055,.053,.038],'overshirt','clothing')
    loft(label+'_cuff',[(.978,.038,.038,wrist[0],wrist[1]),(.994,.043,.043,wrist[0],wrist[1]),(1.018,.044,.044,wrist[0],wrist[1]),(1.032,.040,.040,wrist[0],wrist[1])],'overshirt_shadow',18,48,'clothing')
    palm=wrist+np.array([s*.001,-.004,-.043])
    ellipsoid(label+'_hand',palm,[.028,.019,.045],'skin','hands')
    for k in range(4):
      x=palm[0]+(k-1.5)*.0130
      base=np.array([x,palm[1]-.001,palm[2]-.025]);length=[.046,.057,.054,.043][k]
      end=base+np.array([s*.004,-.010,-length])
      tube(label+f'_finger_{k}',[base,base+[0,-.007,-length*.5],end],[.0068,.0062,.0037],'skin',20,12,'hands')
    thumb=palm+[-s*.025,-.007,.013]
    tube(label+'_thumb',[thumb,thumb+[-s*.012,-.005,-.021],thumb+[-s*.009,-.017,-.039]],[.0097,.0076,.0049],'skin',22,14,'hands')

# ---------------------------------------------------------------- head
# One continuous parametric surface, as in both earlier studies. The jaw is
# rounded rather than squared, the brow ridge shallow, the chin narrow: the
# shape cues sit between the two, deliberately.
HZ=np.array([1.570,1.584,1.602,1.623,1.647,1.675,1.706,1.741,1.776,1.808,1.836,1.856,1.866])
HX=np.array([.010,.034,.056,.076,.090,.102,.110,.113,.110,.097,.071,.037,.002])
HY=np.array([.030,.053,.070,.084,.095,.106,.115,.121,.121,.109,.083,.047,.002])
RX=PchipInterpolator(HZ,HX);RY=PchipInterpolator(HZ,HY)
def gauss(x,z,xx,zz,wx,wz):return np.exp(-((x-xx)/wx)**2-((z-zz)/wz)**2)
def face_y(x,z):
    rx=float(RX(z));ry=float(RY(z));base=.008-ry*np.sqrt(max(0,1-(x/max(rx,.001))**2))
    d=0
    for s in [-1,1]:
      d-=.0068*gauss(x,z,s*.061,1.724,.028,.028)   # cheekbone
      d+=.0060*gauss(x,z,s*.058,1.693,.029,.022)   # cheek hollow
      d+=.0070*gauss(x,z,s*.045,1.748,.025,.016)   # eye socket
      d-=.0042*gauss(x,z,s*.044,1.773,.032,.012)   # brow ridge, shallow
      d-=.0052*gauss(x,z,s*.038,1.628,.026,.024)   # jaw corner, rounded
      d-=.0068*gauss(x,z,s*.0150,1.6975,.0072,.0096)  # alar wing
    d-=.0086*gauss(x,z,0,1.746,.0160,.044)         # nasal bridge
    d-=.0150*gauss(x,z,0,1.6995,.0126,.0132)       # nose ball
    d+=.0025*gauss(x,z,0,1.654,.036,.020)          # mouth recess
    d+=.0029*gauss(x,z,0,1.678,.009,.010)          # philtrum
    d-=.0165*gauss(x,z,0,1.615,.027,.020)          # chin, narrow
    return base+d
head=[]
for z in np.linspace(HZ[0],HZ[-1],150):
    row=[]
    for a in np.linspace(0,2*np.pi,152,endpoint=False):
      x=float(RX(z))*np.sin(a);y=.008-float(RY(z))*np.cos(a)
      if np.cos(a)>0:y+=(face_y(x,z)-(.008-float(RY(z))*np.cos(a)))*max(np.cos(a),0)**.5
      row.append([x,y,z])
    head.append(row)
grid_mesh('face_sculpt',head,'skin',True,'head')

for s,label in [(-1,'L'),(1,'R')]:
    ellipsoid(label+'_ear',[s*.1115,.015,1.718],[.0130,.0102,.0288],'skin','head')
    ellipsoid(label+'_ear_inner',[s*.1175,.005,1.720],[.0058,.0041,.0170],'skin_shadow','head')
    strip(label+'_ear_helix',[[s*.109,-.006,1.740],[s*.122,.008,1.728],[s*.122,.024,1.710],[s*.112,.026,1.696]],[.0034,.0050,.0048,.0029],.0031,'skin',(s,0,.25),28,'head',10)
    ex=s*.0442;ez=1.748
    def eye_z(u,v,ez=ez,s=s):
      tilt=s*u*.0015
      return ez+tilt+(.0086 if v>=0 else .0068)*v*(max(0,1-u*u)**.7)
    def eye_y(x,z,u,v):return face_y(x,z)-.0017-.0029*(1-u*u)*(1-v*v)
    eye=[]
    for u in np.linspace(-1,1,40):
      row=[]
      for v in np.linspace(-1,1,20):
        x=ex+.0250*u;z=eye_z(u,v);row.append([x,eye_y(x,z,u,v),z])
      eye.append(row)
    grid_mesh(label+'_eye_white',eye,'eye_white',False,'face',reverse=True)
    for name,radius,mat,offset in [('iris_rim',.0090,'iris_edge',.0004),('iris',.0082,'iris',.0007),('pupil',.0040,'pupil',.0010)]:
      iris=[]
      for r in np.linspace(.00008,radius,16):
        row=[]
        for a in np.linspace(0,2*np.pi,48,endpoint=False):
          x=ex+r*np.cos(a);z=ez-.0004+r*np.sin(a);u=(x-ex)/.0250
          z=np.clip(z,eye_z(u,-1)+.00035,eye_z(u,1)-.00035)
          vy=(z-ez-s*u*.0015)/((.0086 if z>=ez else .0068)*max(1e-3,(1-u*u)**.7))
          row.append([x,eye_y(x,z,u,vy)-offset,z])
        iris.append(row)
      grid_mesh(label+'_'+name,iris,mat,True,'face',reverse=True)
    ellipsoid(label+'_eye_catchlight',[ex-.0022,face_y(ex,ez)-.0067,ez+.0028],[.00112,.00068,.00112],'eye_white','face')
    for name,vv,mat,rad in [('upper_lid',1,'skin',.0026),('lower_lid',-1,'skin_shadow',.00085),('upper_lash',1,'brow',.00052)]:
      pts=[]
      for u in np.linspace(-.98,.98,18):
        x=ex+.0250*u;z=eye_z(u,vv)+(.0004 if name=='upper_lash' else 0)
        pts.append([x,face_y(x,z)-.0024-(.0006 if name=='upper_lash' else 0),z])
      tube(label+'_'+name,pts,[rad*.5,rad,rad*.35],mat,40,10,'face')
    # A brow with a soft arch: neither the level bar nor the high curve.
    browpts=[]
    for u in np.linspace(-1,1,12):
      x=ex+.0276*u;z=1.769+.0034*(1-u*u)+s*u*.0014
      browpts.append([x,face_y(x,z)-.0020,z])
    strip(label+'_brow',browpts,[.0024,.0060,.0056,.0014],.0011,'brow',(0,-1,0),36,'face',8)
    x=s*.0142;z=1.6895
    ellipsoid(label+'_nostril',[x,face_y(x,z)+.0013,z],[.0033,.0019,.0018],'skin_shadow','face')

# Lips: even upper and lower height, soft corners.
for upper in [True,False]:
    lip=[]
    for u in np.linspace(-1,1,65):
      row=[];x=.0330*u
      seam=1.654-.0021*(1-u*u)
      height=(.0060+.0014*np.exp(-((abs(u)-.28)/.16)**2)-.0009*np.exp(-(u/.12)**2)) if upper else .0070
      for v in np.linspace(0,1,15):
        z=seam+(1 if upper else -1)*height*(max(0,1-u*u)**.8)*v
        y=face_y(x,z)-(.0015+.0034*np.sin(np.pi*v*.95))*(1-u*u)
        row.append([x,y,z])
      lip.append(row)
    grid_mesh('upper_lip' if upper else 'lower_lip',lip,'lip',False,'face',reverse=upper)
mouth=[]
for u in np.linspace(-.99,.99,16):
  x=.0330*u;z=1.654-.0021*(1-u*u);mouth.append([x,face_y(x,z)-.0020,z])
tube('lip_line',mouth,[.0003,.00066,.0003],'lip_dark',45,8,'face')

# ---------------------------------------------------------------- hair
# Grown-out crop, parted off-centre and tucked behind one ear: long enough to
# fall past the temple, short enough to leave the neck open.
CZ,RZ,SX,SY=1.746,.140,.122,.130
CAP=.0032
def hairline_z(aa):
    return float(np.interp(abs(aa),[0.0,0.45,0.85,1.25,1.60,2.40,np.pi],[1.804,1.802,1.812,1.786,1.762,1.734,1.716]))
cap=[]
for v in np.linspace(.001,1,64):
  row=[]
  for a in np.linspace(0,2*np.pi,150,endpoint=False):
    aa=abs((a+np.pi)%(2*np.pi)-np.pi);end=hairline_z(aa)
    phi=v*(np.arccos(np.clip((end-CZ)/RZ,-1,1)) if end>=CZ else np.pi/2)
    row.append([(SX-CAP)*np.sin(phi)*np.sin(a),.010-(SY-CAP)*np.sin(phi)*np.cos(a),CZ+(RZ-CAP)*np.cos(phi)])
  cap.append(row)
grid_mesh('crop_cap',cap,'hair',True,'hair',reverse=True)

def cap_pt(aa,phi,push=.0):
    return [(SX+push)*np.sin(phi)*np.sin(aa),.010-(SY+push)*np.sin(phi)*np.cos(aa),CZ+(RZ+push)*np.cos(phi)]
def cap_end_phi(aa):
    return float(np.arccos(np.clip((hairline_z(aa)-CZ)/RZ,-1,1)))
for k,aa in enumerate(np.linspace(-np.pi+.08,np.pi-.08,36)):
    pe=cap_end_phi(aa);j=.0013*np.sin(k*2.3);w=.0250+.0038*np.sin(k*1.7)
    r0=.15+.11*abs(np.sin(k*1.27));pe2=pe*(.84+.12*abs(np.sin(k*1.6)))
    pts=[cap_pt(aa+.10*np.sin(k*2.1),r0,.0),cap_pt(aa,pe*.42,.0004),cap_pt(aa,pe*.74,.0006),cap_pt(aa,pe2+j*4,.0)]
    strip(f'crop_lock_{k:02d}',pts,[.0112,w,w*.96,w*.84],.0020,['hair','hair_light','hair','hair_fade'][k%4],(np.sin(aa),-np.cos(aa),0),40,'hair',10)
# The part sits off centre; a few longer pieces fall past the right temple
# while the left side stays tucked behind the ear.
for k,aa in enumerate([-1.34,-.92,-.44,.26,.78,1.24,1.62]):
    pe=cap_end_phi(aa);drop=[.16,.22,.12,.09,.20,.30,.36][k]
    pts=[cap_pt(aa+.05,pe*.46,.0022),cap_pt(aa+.02,pe*.82,.0026),cap_pt(aa,pe+drop,.0014)]
    strip(f'crop_fall_{k}',pts,[.0106,.0180,.0064],.0017,['hair_light','hair'][k%2],(np.sin(aa),-np.cos(aa),.20),32,'hair',10)
for k,aa in enumerate([-2.58,2.58]):
    pts=[cap_pt(aa,.05,.0020),cap_pt(aa+.38,.30,.0024),cap_pt(aa+.68,.58,.0018)]
    strip(f'crown_whorl_{k}',pts,[.0100,.0195,.0080],.0016,'hair_light',(np.sin(aa),-np.cos(aa),.4),28,'hair',10)

# ---------------------------------------------------------------- assembly
SKELETON = LANDMARKS.skeleton()
export_avatar(PARTS, PALETTE, SKELETON, LANDMARKS, OUT, "kai-study")
