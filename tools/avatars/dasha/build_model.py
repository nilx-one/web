# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Dasha study 01 — editable procedural sculpture, not a biometric reconstruction.

Run: python build_model.py --output DIRECTORY
Dependencies: numpy, scipy, trimesh, pygltflib. Z-up authoring; Y-up glTF export.
The proportions are artistic design choices, not measurements of the subject.
"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rig import Landmarks, export_avatar
LANDMARKS = Landmarks()
import argparse, json, math
import numpy as np
from scipy.interpolate import PchipInterpolator, CubicSpline
import trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

parser=argparse.ArgumentParser(); parser.add_argument('--output',default='../dasha-3d-output'); args=parser.parse_args()
OUT=Path(args.output).resolve(); OUT.mkdir(parents=True,exist_ok=True)
PARTS=[]
PALETTE={
 'skin':('#e0b79e',.67,0), 'skin_shadow':('#c18d7c',.74,0),
 'lip':('#a65358',.47,0), 'lip_dark':('#75353c',.65,0),
 'brow':('#695142',.8,0), 'eye_white':('#eee5d9',.34,0),
 'iris':('#687263',.40,0), 'iris_edge':('#485044',.48,0), 'pupil':('#171d1c',.24,0),
 'hair':('#9a784b',.60,0), 'hair_light':('#bb9766',.56,0),
 'hair_gold':('#ac8958',.59,0), 'hair_shadow':('#856541',.65,0),
 'jacket':('#69727b',.88,0), 'lapel':('#78828d',.82,0), 'seam':('#535c65',.9,0),
 'ivory':('#e5e3dc',.90,0), 'leather':('#252a2e',.43,.05),
 'sole':('#171b1e',.74,0), 'silver':('#bdc3c6',.22,.88), 'button':('#39434b',.4,.35)
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
    for i,(p,t,r) in enumerate(zip(path,tang,rr)):
      v=np.cross(t,[0,1,0])
      if np.linalg.norm(v)<.01:v=np.cross(t,[1,0,0])
      v/=np.linalg.norm(v);w=np.cross(t,v)
      grid.append([p+r*(np.cos(a)*v+elliptic*np.sin(a)*w) for a in np.linspace(0,2*np.pi,sides,endpoint=False)])
    m=grid_mesh(name,grid,mat,True,group)
    # End caps make even very small finger/hair pieces reliable for export.
    return m

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

def torus(name,center,major,minor,mat,group='details',rotation=None):
    m=trimesh.creation.torus(major_radius=major,minor_radius=minor,major_sections=64,minor_sections=12)
    # Default torus lies in XY; make it lie in XZ, facing forward.
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi/2,[1,0,0]))
    if rotation is not None:m.apply_transform(rotation)
    m.vertices+=center;return add(name,m.vertices,m.faces,mat,group)

def panel(name,verts,mat,group='clothing',thickness=.0025):
    v=np.asarray(verts,float);c=v.mean(axis=0);front=np.vstack([c,v]);back=front+[0,thickness,0]
    n=len(v);faces=[]
    for i in range(n):
      a=i+1;b=(i+1)%n+1
      faces.extend([[0,a,b],[n+1,n+1+b,n+1+a],[a,n+1+a,n+1+b],[a,n+1+b,b]])
    return add(name,np.vstack([front,back]),faces,mat,group)

# Boots and legs; an understated asymmetry keeps the standing pose natural.
for side,cx,cy in [('L',-.078,.010),('R',.086,-.025)]:
    loft(side+'_leg',[(.43,.034,.037,cx,cy),(.52,.038,.039,cx,cy),(.62,.043,.044,cx,cy),(.76,.053,.054,cx,cy),(.96,.058,.054,cx*.88,cy+.010)],'skin',50,64)
    loft(side+'_boot_shaft',[(.080,.039,.047,cx,cy),(.14,.037,.043,cx,cy),(.22,.041,.043,cx,cy+.005),(.33,.049,.048,cx,cy),(.46,.049,.048,cx,cy),(.535,.048,.047,cx,cy)],'leather',60,72,'boots')
    loft(side+'_boot_foot',[(.029,.045,.118,cx,cy-.041),(.037,.048,.125,cx,cy-.045),(.062,.049,.124,cx,cy-.046),(.083,.046,.109,cx,cy-.034),(.106,.041,.075,cx,cy-.009),(.139,.037,.043,cx,cy)],'leather',42,64,'boots')
    loft(side+'_boot_sole',[(.018,.044,.116,cx,cy-.042),(.021,.049,.124,cx,cy-.043),(.031,.049,.126,cx,cy-.045),(.036,.046,.122,cx,cy-.045)],'sole',12,64,'boots')
    tube(side+'_boot_rim',[[cx+.048*np.sin(a),cy-.047*np.cos(a),.535] for a in np.linspace(0,2*np.pi,20)], [.0018,.0018],'leather',65,8,'boots')
    tube(side+'_boot_back_seam',[[cx,cy+.044,.145],[cx,cy+.049,.32],[cx,cy+.044,.527]],[.0009,.0009],'sole',40,6,'boots')

# Shirt and neck, fully covered under the jacket.
loft('ivory_top',[(1.04,.114,.067,0,0),(1.17,.124,.080,0,0),(1.31,.153,.087,0,0),(1.395,.139,.068,0,0),(1.423,.06,.046,0,.004)],'ivory',55,80,'clothing')
loft('neck',[(1.385,.064,.049,0,.005),(1.437,.044,.041,0,.009),(1.495,.037,.037,0,.009),(1.539,.051,.04,0,.009)],'skin',50,64,'head')
neckline=[[.058*np.sin(a),.004-.048*np.cos(a),1.418-.012*np.cos(a)] for a in np.linspace(0,2*np.pi,30)]
tube('shirt_neck_binding',neckline,[.0022,.0022],'ivory',70,10,'clothing')

# Sculpted jacket shell, open in a V at the top.
coat_sections=[(.876,.185,.106,0,0),(.898,.184,.107,0,0),(1.015,.160,.095,0,0),(1.135,.136,.085,0,0),(1.258,.148,.097,0,0),(1.356,.171,.099,0,.007),(1.409,.185,.078,0,.009),(1.438,.153,.061,0,.010),(1.453,.060,.044,0,.010),(1.457,.046,.040,0,.010)]
gap=lambda z:float(np.interp(z,[.876,1.13,1.23,1.43],[.005,.05,.29,.47]))
loft('tailored_jacket',coat_sections,'jacket',92,104,'clothing',gap)
for s,label in [(-1,'L'),(1,'R')]:
    # Collar and notched lapel are separate editable pieces.
    panel(label+'_lapel',[[s*.039,-.051,1.444],[s*.104,-.075,1.421],[s*.147,-.094,1.371],[s*.122,-.106,1.355],[s*.150,-.107,1.329],[s*.017,-.090,1.134],[s*.047,-.103,1.302]],'lapel')
    panel(label+'_collar',[[s*.040,-.030,1.459],[s*.082,-.034,1.446],[s*.130,-.073,1.386],[s*.104,-.077,1.407],[s*.041,-.060,1.427]],'jacket')
    tube(label+'_lapel_stitch',[[s*.039,-.054,1.441],[s*.099,-.079,1.418],[s*.137,-.098,1.373]],[.0007,.0007],'seam',30,6,'clothing')
    wrist=np.array([s*(.229 if s<0 else .232),-.004 if s<0 else -.027,.967 if s<0 else .993])
    shoulder=[s*.151,.008,1.403];elbow=[s*.222,.015 if s<0 else -.025,1.191]
    tube(label+'_jacket_sleeve',[shoulder,[s*.205,.004,1.304],elbow,wrist],[.054,.060,.050,.040],'jacket',65,40,'clothing',.98)
    # Soft shoulder cap is largely embedded in the coat for a continuous silhouette.
    ellipsoid(label+'_shoulder',[s*.177,.007,1.375],[.061,.061,.063],'jacket','clothing')
    cuff=wrist.copy();cuff[2]+=.009
    tube(label+'_cuff_seam',[cuff+[-.034,-.013,0],cuff+[0,-.037,-.002],cuff+[.034,-.013,0]],[.0010,.0010],'seam',24,8,'clothing')
    for k in range(3):
      ellipsoid(label+f'_cuff_button_{k}',[wrist[0]+s*.035,wrist[1]-.014,wrist[2]+.020+k*.011],[.0030,.0021,.0030],'button','details')
    # Slightly curved palms and fingers, all sculpted geometry.
    palm=wrist+np.array([s*.001,-.003,-.039])
    ellipsoid(label+'_hand',palm,[.027,.018,.040],'skin','hands')
    for k in range(4):
      x=palm[0]+(k-1.5)*.012
      base=np.array([x,palm[1]-.001,palm[2]-.022]);length=[.042,.052,.049,.039][k]
      end=base+np.array([s*.003,-.008,-length])
      tube(label+f'_finger_{k}',[base,base+[0,-.006,-length*.5],end],[.0062,.0057,.0034],'skin',20,12,'hands')
    thumb=palm+[-s*.023,-.006,.011]
    tube(label+'_thumb',[thumb,thumb+[-s*.012,-.004,-.02],thumb+[-s*.008,-.016,-.037]],[.009,.007,.0045],'skin',22,14,'hands')
    # Welt pockets and double-breasted buttons.
    panel(label+'_pocket_welt',[[s*.069,-.083,1.054],[s*.131,-.052,1.049],[s*.131,-.054,1.037],[s*.067,-.086,1.042]],'seam')
    for z in [1.133,1.064]:
      ellipsoid(label+f'_button_{z}',[s*.040,-.087,z],[.0072,.0033,.0072],'button','details')

# Facial anatomy is one continuous parametric mesh, with integrated nose and cheeks.
HZ=np.array([1.486,1.498,1.515,1.540,1.572,1.610,1.648,1.681,1.717,1.753,1.783,1.798,1.804])
HX=np.array([.009,.032,.056,.080,.099,.115,.123,.125,.120,.103,.070,.036,.002])
HY=np.array([.036,.055,.068,.077,.083,.091,.101,.106,.107,.099,.076,.042,.002])
RX=PchipInterpolator(HZ,HX);RY=PchipInterpolator(HZ,HY)
def gauss(x,z,xx,zz,wx,wz):return np.exp(-((x-xx)/wx)**2-((z-zz)/wz)**2)
def face_y(x,z):
    rx=float(RX(z));ry=float(RY(z));base=.009-ry*np.sqrt(max(0,1-(x/max(rx,.001))**2))
    d=0
    for s in [-1,1]:
      d-=.008*gauss(x,z,s*.066,1.632,.032,.034)
      d+=.006*gauss(x,z,s*.048,1.677,.027,.018)
      d-=.004*gauss(x,z,s*.048,1.702,.038,.015)
    d-=.007*gauss(x,z,0,1.577,.043,.029)
    d-=.015*gauss(x,z,0,1.663,.014,.036)
    d-=.027*gauss(x,z,0,1.629,.019,.013)
    d-=.006*gauss(x,z,0,1.535,.034,.021)
    return base+d
head=[]
for z in np.linspace(HZ[0],HZ[-1],150):
    row=[]
    for a in np.linspace(0,2*np.pi,152,endpoint=False):
      x=float(RX(z))*np.sin(a);y=.009-float(RY(z))*np.cos(a)
      if np.cos(a)>0:y+=(face_y(x,z)-(.009-float(RY(z))*np.cos(a)))*max(np.cos(a),0)**.5
      row.append([x,y,z])
    head.append(row)
grid_mesh('face_sculpt',head,'skin',True,'head')

for s,label in [(-1,'L'),(1,'R')]:
    ellipsoid(label+'_ear',[s*.122,.012,1.637],[.020,.013,.034],'skin','head')
    ellipsoid(label+'_ear_inner',[s*.131,.001,1.639],[.009,.005,.021],'skin_shadow','head')
    torus(label+'_earring',[s*.130,-.006,1.594],.015,.0018,'silver')
    ex=s*.048;ez=1.677
    def eye_z(u,v):
      tilt=s*u*.0016
      return ez+tilt+( .0125 if v>=0 else .0080)*v*(max(0,1-u*u)**.7)
    def eye_y(x,z,u,v):return face_y(x,z)-.0018-.0033*(1-u*u)*(1-v*v)
    eye=[]
    for u in np.linspace(-1,1,40):
      row=[]
      for v in np.linspace(-1,1,20):
        x=ex+.026*u;z=eye_z(u,v);row.append([x,eye_y(x,z,u,v),z])
      eye.append(row)
    grid_mesh(label+'_eye_white',eye,'eye_white',False,'face',reverse=True)
    # Iris layers sit on the same curved eye surface and stay within the eyelids.
    for name,radius,mat,offset in [('iris_rim',.0097,'iris_edge',.0004),('iris',.0088,'iris',.0007),('pupil',.0044,'pupil',.0010)]:
      iris=[]
      for r in np.linspace(.00008,radius,16):
        row=[]
        for a in np.linspace(0,2*np.pi,48,endpoint=False):
          x=ex+r*np.cos(a);z=ez+.0006+r*np.sin(a);u=(x-ex)/.026
          z=np.clip(z,eye_z(u,-1)+.00035,eye_z(u,1)-.00035)
          vy=(z-ez-s*u*.0016)/((.0125 if z>=ez else .0080)*max(1e-3,(1-u*u)**.7))
          row.append([x,eye_y(x,z,u,vy)-offset,z])
        iris.append(row)
      grid_mesh(label+'_'+name,iris,mat,True,'face',reverse=True)
    ellipsoid(label+'_eye_catchlight',[ex-.0022,face_y(ex,ez)-.0074,ez+.0032],[.00125,.00075,.00125],'eye_white','face')
    for name,vv,mat,rad in [('upper_lid',1,'skin',.0016),('lower_lid',-1,'skin_shadow',.00085),('upper_lash',1,'brow',.00065)]:
      pts=[]
      for u in np.linspace(-.98,.98,18):
        x=ex+.026*u;z=eye_z(u,vv)+( .0006 if name=='upper_lash' else 0)
        pts.append([x,face_y(x,z)-.0024-(.0007 if name=='upper_lash' else 0),z])
      tube(label+'_'+name,pts,[rad*.5,rad,rad*.35],mat,40,10,'face')
    browpts=[]
    for u in np.linspace(-1,1,12):
      x=ex+.028*u;z=1.703+.004*(1-u*u)+s*u*.001
      browpts.append([x,face_y(x,z)-.002,z])
    strip(label+'_brow',browpts,[.002,.0057,.0048,.0012],.0008,'brow',(0,-1,0),36,'face',8)
    # Small nostril recesses; no detachable geometric nose.
    x=s*.012;z=1.619
    ellipsoid(label+'_nostril',[x,face_y(x,z)-.0013,z],[.0042,.0017,.0018],'skin_shadow','face')

# Cupid's bow and softly modeled lower lip.
for upper in [True,False]:
    lip=[]
    for u in np.linspace(-1,1,65):
      row=[];x=.033*u
      seam=1.575-.002*(1-u*u)
      height=(.0068+.002*np.exp(-((abs(u)-.27)/.15)**2)-.001*np.exp(-(u/.12)**2)) if upper else .010
      for v in np.linspace(0,1,15):
        z=seam+(1 if upper else -1)*height*(max(0,1-u*u)**.8)*v
        y=face_y(x,z)-(.0018+.0045*np.sin(np.pi*v*.95))*(1-u*u)
        row.append([x,y,z])
      lip.append(row)
    grid_mesh('upper_lip' if upper else 'lower_lip',lip,'lip',False,'face',reverse=upper)
mouth=[]
for u in np.linspace(-.99,.99,16):
  x=.033*u;z=1.575-.002*(1-u*u);mouth.append([x,face_y(x,z)-.0022,z])
tube('lip_line',mouth,[.0003,.00065,.0003],'lip_dark',45,8,'face')

# Rounded bob foundation: crown through the sides/back; open at the face.
hairgrid=[]
for v in np.linspace(.001,1,72):
  row=[]
  for a in np.linspace(0,2*np.pi,140,endpoint=False):
    aa=abs((a+np.pi)%(2*np.pi)-np.pi)
    end=1.705-.185*np.clip((aa-.62)/.57,0,1)
    if end>=1.674:
      phi=v*np.arccos((end-1.674)/.143);radx=.140*np.sin(phi);rady=.119*np.sin(phi);z=1.674+.143*np.cos(phi)
    elif v<.47:
      phi=(v/.47)*np.pi/2;radx=.140*np.sin(phi);rady=.119*np.sin(phi);z=1.674+.143*np.cos(phi)
    else:
      t=(v-.47)/.53;radx=.140*(1-.055*t+.035*np.sin(t*np.pi));rady=.119*(1-.02*t);z=1.674+(end-1.674)*t
    row.append([radx*np.sin(a),.013-rady*np.cos(a),z])
  hairgrid.append(row)
grid_mesh('bob_foundation',hairgrid,'hair',True,'hair',reverse=True)

for k,a in enumerate(np.linspace(.67,2*np.pi-.67,36)):
    sa,ca=np.sin(a),np.cos(a);j=.003*np.sin(k*4.2)
    pts=[[.030*sa,-.026*ca+.013,1.814],[.112*sa,-.099*ca+.012,1.758],[.142*sa,-.123*ca+.013,1.665],[.144*sa,-.124*ca+.014,1.582],[.133*sa,-.116*ca+.014,1.519+j]]
    mat=['hair_gold','hair','hair_light','hair_gold'][k%4]
    strip(f'bob_lock_{k:02d}',pts,[.008,.022,.025,.021,.012],.0029,mat,(sa,-ca,0),54,'hair',10)
    # Fine, low-contrast ridges sculpt the direction without using alpha hair cards.
    if k%2==0:
      p=np.asarray(pts);p[:,0]+=sa*.003;p[:,1]-=ca*.003
      tube(f'bob_ridge_{k:02d}',p,[.0007,.0011,.0004],'hair_light',43,6,'hair')

# Swept fringe with a small off-centre opening, following the photographed bob.
for k,xend in enumerate(np.linspace(-.115,.110,16)):
    z_end=1.704+.013*np.exp(-((xend-.017)/.030)**2)-.014*(abs(xend)/.115)**2
    y_end=face_y(float(xend),z_end)-.007
    pts=[[.017+(xend-.017)*.24,-.008,1.813],[.018+(xend-.018)*.65,-.079,1.784],[xend*.96,-.113,1.741],[xend,y_end,z_end]]
    strip(f'fringe_{k:02d}',pts,[.007,.020,.019,.004],.0034,['hair_gold','hair_light','hair_gold','hair'][k%4],(0,-1,.13),52,'hair',10)

# Two curved face-framing sections reach the jaw and break the edge of the cap.
for s,label in [(-1,'L'),(1,'R')]:
  strip(label+'_face_frame',[[s*.043,-.034,1.805],[s*.109,-.088,1.748],[s*.134,-.062,1.654],[s*.134,-.042,1.569],[s*.118,-.025,1.518]],[.011,.028,.027,.021,.008],.0045,'hair_gold',(s*.6,-1,0),64,'hair',12)

# One assembled character scene. No stage, lights, photos or hidden reference images.
SKELETON = LANDMARKS.skeleton()
export_avatar(PARTS, PALETTE, SKELETON, LANDMARKS, OUT, "dasha-study")
