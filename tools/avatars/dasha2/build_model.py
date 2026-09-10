# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Dasha 2.0 — editable procedural sculpture, not a biometric reconstruction.

Run: python build_model.py --output DIRECTORY
Dependencies: numpy, scipy, trimesh. Z-up authoring; Y-up glTF export.
The proportions are artistic design choices, not measurements of the subject.
"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rig import Landmarks, export_modular_avatar
LANDMARKS = Landmarks()
import argparse
import numpy as np
from scipy.interpolate import PchipInterpolator, CubicSpline
import trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

parser=argparse.ArgumentParser(); parser.add_argument('--output',default='deploy/web/avatars/0.3.0'); args=parser.parse_args()
OUT=Path(args.output).resolve(); OUT.mkdir(parents=True,exist_ok=True)
PARTS=[]
PALETTE={
 'skin':('#e5b8a1',.52,0), 'skin_shadow':('#be8775',.65,0),
 'lip':('#b76c70',.34,0), 'lip_dark':('#7b454b',.60,0),
 'brow':('#44332d',.77,0), 'eye_white':('#eee8df',.20,0),
 'iris':('#7d8677',.25,0), 'iris_edge':('#454b42',.35,0), 'pupil':('#101713',.12,0),
 'hair':('#463129',.43,0), 'hair_light':('#5c4133',.42,0), 'hair_shadow':('#352720',.51,0),
 'cotton':('#252428',.92,0), 'cotton_seam':('#353438',.95,0),
 'trouser':('#ded5c5',.89,0), 'stitch':('#b8ab95',.94,0),
 'leather':('#202126',.32,.04), 'sole':('#12151a',.78,0),
 'silver':('#c6cbd0',.19,.90),
 # Materials the alternative wearables are cut from. A wardrobe item owns its
 # own cloth: nothing recolours a garment that is already on the body.
 'charcoal':('#3b3d43',.90,0), 'indigo':('#3c4570',.86,0),
 'canvas':('#eeece4',.88,0), 'rubber':('#cfccc2',.72,0),
 'lace_cord':('#dedbd0',.95,0)
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
    m=trimesh.creation.uv_sphere(count=[20,28]);m.vertices*=scale
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
    m=trimesh.creation.torus(major_radius=major,minor_radius=minor,major_sections=40,minor_sections=10)
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

# Clothing is sculpted in volume, not a photograph projected onto a plane.
# The loose trousers meet a separate waistband; cuff and pocket details deform
# with the same semantic leg family as their underlying cloth.
for s,side in [(-1,'L'),(1,'R')]:
    cx=s*.084
    foot=[(.023,.047,.109,cx,-.047),(.035,.053,.122,cx,-.050),
          (.060,.054,.119,cx,-.048),(.083,.050,.103,cx,-.034),
          (.112,.042,.074,cx,-.010),(.145,.033,.039,cx,.008)]
    loft(side+'_shoe_upper',foot,'leather',30,48,'shoes')
    loft(side+'_shoe_sole',[(0,.048,.111,cx,-.048),(.008,.056,.124,cx,-.050),
         (.030,.056,.125,cx,-.050),(.037,.052,.120,cx,-.049)],'sole',8,48,'shoes')
    # Raised loafer apron and saddle strap.
    pts=[[cx+.037*np.sin(a),-.052-.094*np.cos(a),.086+.012*np.cos(a)]
         for a in np.linspace(-1.55,1.55,20)]
    tube(side+'_shoe_apron',pts,[.0016,.0016],'leather',32,6,'shoes')
    tube(side+'_shoe_saddle',[[cx-.040,-.045,.100],[cx,-.054,.122],
         [cx+.040,-.045,.100]],[.009,.009],'leather',18,8,'shoes',.38)
    loft(side+'_sock',[(.112,.032,.036,cx,.004),(.19,.035,.038,cx,.004),
         (.235,.033,.037,cx,.004)],'cotton',12,32,'shoes')
    sections=[(.17,.059,.054,cx,0),(.21,.060,.055,cx,.002),(.32,.062,.058,cx,.004),
              (.49,.060,.061,cx,.003),(.64,.065,.068,cx,.004),
              (.78,.080,.078,cx*.99,.005),(.90,.092,.085,cx*.91,.003),
              (.99,.093,.086,cx*.78,0)]
    leg=loft(side+'_leg',sections,'trouser',58,64)
    # Millimetre-scale cloth folds are real mesh displacements, deterministic.
    v=leg.vertices; z=v[:,2]; theta=np.arctan2(v[:,0]-cx,-v[:,1])
    fold=.0017*np.sin(9*theta+z*7)*np.exp(-((z-.42)/.26)**2)
    fold+=.0020*np.sin(20*z+theta*2)*np.exp(-((z-.24)/.10)**2)
    v[:,0]+=fold*np.sin(theta);v[:,1]-=fold*np.cos(theta)
    # Join two leg volumes into left/right halves of one hip envelope.
    # The medial surfaces converge inside the body, while front/back meet at
    # the same centreline. This avoids open or overlapping waistband edges.
    sec=np.asarray(sections)
    cross=PchipInterpolator(sec[:,0],sec[:,1:],axis=0)(z)
    angle=np.arctan2((s*v[:,0]-s*cross[:,2])/cross[:,0],
                    -(v[:,1]-cross[:,3])/cross[:,1])
    blend=np.clip((z-.83)/.16,0,1);blend=blend*blend*(3-2*blend)
    hip_x=s*.134*np.maximum(0,np.sin(angle))
    hip_y=-.083*np.cos(angle)
    v[:,0]=v[:,0]*(1-blend)+hip_x*blend
    v[:,1]=v[:,1]*(1-blend)+hip_y*blend
    v[:,2]+=blend*.068
    loft(side+'_jogger_cuff',[(.164,.060,.056,cx,0),(.170,.064,.059,cx,0),
         (.218,.064,.059,cx,0),(.224,.060,.056,cx,0)],'trouser',9,48)
    tube(side+'_jogger_outseam',[[cx+s*.061,.002,.23],[cx+s*.064,.004,.49],
         [cx+s*.077,.005,.76],[cx+s*.086,0,.965]],[.00065,.00065],'stitch',42,5)
# The joined legs reach the waistband; no separate overlapping hip shell.
loft('waistband',[(1.025,.139,.089,0,0),(1.056,.134,.086,0,0),
     (1.063,.130,.083,0,0)],'trouser',8,64,'clothing')
for s,side in [(-1,'L'),(1,'R')]:
    tube(side+'_pocket',[[s*.083,-.074,1.029],[s*.103,-.070,.997],
         [s*.127,-.055,.950]],[.0011,.0011],'stitch',25,6,'clothing')
    for x,y in [(s*.053,-.079),(s*.123,-.029),(s*.085,.063)]:
        tube(side+f'_belt_loop_{x}',[[x,y,1.015],[x,y-.002,1.039],[x,y,1.060]],
             [.003,.003],'trouser',12,6,'clothing')
tube('fly_seam',[[.011,-.090,1.031],[.011,-.091,.986],[.006,-.089,.955]],
     [.0007,.0007],'stitch',22,6,'clothing')
ellipsoid('waist_button',[0,-.090,1.044],[.0055,.0025,.0055],'silver','details')

# Fitted crew-neck tee with short sleeves and bare forearms. Store the whole
# shoulder/elbow/wrist centreline for the shared rig, even though only its
# upper segment is covered by a sleeve.
tee=[(1.047,.126,.078,0,0),(1.095,.129,.080,0,0),(1.16,.134,.086,0,0),
     (1.25,.151,.101,0,0),(1.32,.167,.093,0,.006),(1.37,.177,.069,0,.008),
     (1.399,.144,.058,0,.006),(1.422,.057,.044,0,.009)]
loft('overshirt_shell',tee,'cotton',50,72,'clothing')
loft('neck',[(1.399,.056,.044,0,.008),(1.444,.042,.039,0,.009),
     (1.480,.038,.037,0,.009),(1.526,.048,.040,0,.009)],'skin',24,48,'head')
tube('neck_binding',[[.058*np.sin(a),.009-.046*np.cos(a),1.417-.007*np.cos(a)]
     for a in np.linspace(0,2*np.pi,30)],[.003,.003],'cotton_seam',48,8,'clothing')
for s,side in [(-1,'L'),(1,'R')]:
    shoulder=np.array([s*.151,.005,1.351]);elbow=np.array([s*.244,.002,1.172])
    wrist=np.array([s*.285,-.012,.986])
    sleeve_points=[shoulder,[s*.195,.004,1.307],elbow,wrist]
    # The arm is bare geometry in two regions, so a sleeve can hide the part of
    # it that it encloses without hiding the forearm below the hem.
    tube(side+'_upper_arm',[shoulder,[s*.195,.004,1.307],elbow],
         [.047,.044,.032],'skin',30,24,'clothing',.91)
    tube(side+'_lower_arm',[elbow,[s*.265,-.005,1.079],wrist],
         [.032,.027,.022],'skin',26,24,'clothing',.91)
    # Re-register after adding the short cloth sleeve: rig landmarks describe
    # the arm, never the sleeve's shorter hem-to-shoulder length.
    tube(side+'_short_sleeve',[shoulder,[s*.197,.004,1.309],[s*.213,.004,1.273]],
         [.055,.059,.052],'cotton',24,32,'clothing',.97)
    LANDMARKS.paths[side+'_sleeve']=np.asarray(sleeve_points)
    ellipsoid(side+'_shoulder',[s*.166,.005,1.344],[.052,.055,.049],
              'cotton','clothing')
    palm=wrist+[s*.004,-.002,-.039]
    ellipsoid(side+'_hand',palm,[.027,.018,.042],'skin','hands')
    for k,length in enumerate([.040,.052,.048,.037]):
        base=palm+[(k-1.5)*.011,0,-.022]
        end=base+[s*.002,-.009,-length]
        tube(side+f'_finger_{k}',[base,base+[0,-.006,-length*.55],end],
             [.0061,.0056,.0031],'skin',15,10,'hands')
        ellipsoid(side+f'_nail_{k}',end+[0,-.0038,.0045],[.0035,.001,.006],
                  'skin_shadow','hands')
    thumb=palm+[-s*.023,-.001,.012]
    tube(side+'_thumb',[thumb,thumb+[-s*.013,-.003,-.022],thumb+[-s*.010,-.017,-.038]],
         [.009,.007,.0043],'skin',18,10,'hands')

# Facial anatomy is one continuous parametric mesh, with integrated nose and cheeks.
HZ=np.array([1.486,1.498,1.515,1.540,1.572,1.610,1.648,1.681,1.717,1.753,1.783,1.798,1.804])
HX=np.array([.015,.040,.063,.083,.103,.117,.126,.128,.122,.105,.072,.037,.002])
HY=np.array([.036,.055,.068,.077,.083,.091,.101,.106,.107,.099,.076,.042,.002])
RX=PchipInterpolator(HZ,HX);RY=PchipInterpolator(HZ,HY)
def gauss(x,z,xx,zz,wx,wz):return np.exp(-((x-xx)/wx)**2-((z-zz)/wz)**2)
def face_y(x,z):
    rx=float(RX(z));ry=float(RY(z));base=.009-ry*np.sqrt(max(0,1-(x/max(rx,.001))**2))
    d=0
    for s in [-1,1]:
      d-=.010*gauss(x,z,s*.068,1.635,.034,.036)
      d+=.009*gauss(x,z,s*.051,1.677,.030,.024)
      d-=.004*gauss(x,z,s*.048,1.702,.038,.015)
    d-=.007*gauss(x,z,0,1.577,.043,.029)
    d-=.020*gauss(x,z,0,1.663,.017,.038)
    d-=.031*gauss(x,z,0,1.629,.021,.014)
    d-=.006*gauss(x,z,0,1.535,.034,.021)
    return base+d
head=[]
for z in np.linspace(HZ[0],HZ[-1],112):
    row=[]
    for a in np.linspace(0,2*np.pi,112,endpoint=False):
      x=float(RX(z))*np.sin(a);y=.009-float(RY(z))*np.cos(a)
      if np.cos(a)>0:y+=(face_y(x,z)-(.009-float(RY(z))*np.cos(a)))*max(np.cos(a),0)**.5
      row.append([x,y,z])
    head.append(row)
grid_mesh('face_sculpt',head,'skin',True,'head')

for s,label in [(-1,'L'),(1,'R')]:
    ellipsoid(label+'_ear',[s*.122,.012,1.637],[.020,.013,.034],'skin','head')
    ellipsoid(label+'_ear_inner',[s*.131,.001,1.639],[.009,.005,.021],'skin_shadow','head')
    torus(label+'_earring',[s*.130,-.006,1.594],.012,.0042,'silver')
    ex=s*.051;ez=1.677
    def eye_z(u,v):
      tilt=s*u*.0016
      return ez+tilt+( .020 if v>=0 else .012)*v*(max(0,1-u*u)**.7)
    def eye_y(x,z,u,v):return face_y(x,z)-.0018-.0033*(1-u*u)*(1-v*v)
    eye=[]
    for u in np.linspace(-1,1,40):
      row=[]
      for v in np.linspace(-1,1,20):
        x=ex+.0315*u;z=eye_z(u,v);row.append([x,eye_y(x,z,u,v),z])
      eye.append(row)
    grid_mesh(label+'_eye_white',eye,'eye_white',False,'face',reverse=True)
    # Iris layers sit on the same curved eye surface and stay within the eyelids.
    for name,radius,mat,offset in [('iris_rim',.0142,'iris_edge',.0004),('iris',.0131,'iris',.0007),('pupil',.0057,'pupil',.0010)]:
      iris=[]
      for r in np.linspace(.00008,radius,16):
        row=[]
        for a in np.linspace(0,2*np.pi,48,endpoint=False):
          x=ex+r*np.cos(a);z=ez+.0006+r*np.sin(a);u=(x-ex)/.0315
          z=np.clip(z,eye_z(u,-1)+.00035,eye_z(u,1)-.00035)
          vy=(z-ez-s*u*.0016)/((.020 if z>=ez else .012)*max(1e-3,(1-u*u)**.7))
          row.append([x,eye_y(x,z,u,vy)-offset,z])
        iris.append(row)
      grid_mesh(label+'_'+name,iris,mat,True,'face',reverse=True)
    ellipsoid(label+'_eye_catchlight',[ex-.0022,face_y(ex,ez)-.0074,ez+.0032],[.00125,.00075,.00125],'eye_white','face')
    for name,vv,mat,rad in [('upper_lid',1,'skin',.0016),('lower_lid',-1,'skin_shadow',.00085),('upper_lash',1,'brow',.00065)]:
      pts=[]
      for u in np.linspace(-.98,.98,18):
        x=ex+.0315*u;z=eye_z(u,vv)+( .0006 if name=='upper_lash' else 0)
        pts.append([x,face_y(x,z)-.0024-(.0007 if name=='upper_lash' else 0),z])
      tube(label+'_'+name,pts,[rad*.5,rad,rad*.35],mat,40,10,'face')
    browpts=[]
    for u in np.linspace(-1,1,12):
      x=ex+.028*u;z=1.710+.006*(1-u*u)+s*u*.001
      browpts.append([x,face_y(x,z)-.002,z])
    strip(label+'_brow',browpts,[.002,.0075,.0058,.0015],.0008,'brow',(0,-1,0),36,'face',8)
    # Small nostril recesses; no detachable geometric nose.
    x=s*.012;z=1.619
    ellipsoid(label+'_nostril',[x,face_y(x,z)-.0013,z],[.0042,.0017,.0018],'skin_shadow','face')

# Cupid's bow and softly modeled lower lip.
for upper in [True,False]:
    lip=[]
    for u in np.linspace(-1,1,65):
      row=[];x=.039*u
      seam=1.575-.002*(1-u*u)
      height=(.0087+.002*np.exp(-((abs(u)-.27)/.15)**2)-.001*np.exp(-(u/.12)**2)) if upper else .014
      for v in np.linspace(0,1,15):
        z=seam+(1 if upper else -1)*height*(max(0,1-u*u)**.8)*v
        y=face_y(x,z)-(.0018+.0045*np.sin(np.pi*v*.95))*(1-u*u)
        row.append([x,y,z])
      lip.append(row)
    grid_mesh('upper_lip' if upper else 'lower_lip',lip,'lip',False,'face',reverse=upper)
mouth=[]
for u in np.linspace(-.99,.99,16):
  x=.039*u;z=1.575-.002*(1-u*u);mouth.append([x,face_y(x,z)-.0022,z])
tube('lip_line',mouth,[.0003,.00065,.0003],'lip_dark',45,8,'face')

# A swept scalp and low bun replace the first study's bob. Hair is coloured
# geometry: no fragile alpha cards, external textures or billboards.
def scalp(a,v,push=0):
    aa=abs((a+np.pi)%(2*np.pi)-np.pi)
    end=float(np.interp(aa,[0,.50,1.05,1.6,np.pi],[1.730,1.724,1.645,1.602,1.572]))
    phi=v*np.arccos((end-1.665)/.158)
    ripple=.0018*np.sin(18*a+v*3)*np.sin(phi)**2
    return np.array([( .137+push+ripple)*np.sin(phi)*np.sin(a),
                     .018-(.122+push+ripple)*np.sin(phi)*np.cos(a),
                     1.665+(.158+push)*np.cos(phi)])
grid_mesh('swept_scalp',[[scalp(a,v) for a in np.linspace(0,2*np.pi,112,endpoint=False)]
          for v in np.linspace(.002,1,58)],'hair',True,'hair',reverse=True)
ellipsoid('low_bun',[.006,.146,1.637],[.072,.061,.071],'hair','hair')
for k,a in enumerate(np.linspace(.40,2*np.pi-.40,38)):
    points=[scalp(a+(.25*(1-v)),v,.002) for v in [.06,.27,.52,.77,1]]
    strip(f'swept_lock_{k:02d}',points,[.004,.014,.018,.014,.004],.0015,
          ['hair','hair_light','hair','hair_shadow'][k%4],
          (np.sin(a),-np.cos(a),.3),32,'hair',8)
    if k%2==0:
        tube(f'fine_strand_{k:02d}',[p+[0,0,.001] for p in points],
             [.00025,.00048,.00015],'hair_light',28,5,'hair')
# Coiled strands follow the bun's surface; the overlapping core closes it.
for k in range(16):
    a=k*2*np.pi/16
    points=[]
    for t in np.linspace(-1.3,1.3,12):
        points.append([.006+.073*np.cos(a+t*.22)*np.cos(t),
                       .146+.062*np.sin(t),
                       1.637+.072*np.sin(a+t*.22)*np.cos(t)])
    tube(f'bun_coil_{k:02d}',points,[.003,.005,.002],
         ['hair','hair_light','hair_shadow'][k%3],24,8,'hair',.66)
# Side-swept fringe follows the brow without obscuring the eyes.
for k in range(11):
    xend=-.124+k*.009
    zend=1.683+k*.0046
    yend=face_y(xend,zend)-.010 if abs(xend)<float(RX(zend)) else -.030
    pts=[[.022+k*.002,-.035,1.807],[.001-k*.007,-.091,1.780],
         [xend*.86,-.120,1.756],[xend,yend,zend]]
    strip(f'side_fringe_{k:02d}',pts,[.003,.017,.020,.002],.002,
          ['hair','hair_light','hair'][k%3],(0,-1,.20),36,'hair',8)
for s,side in [(-1,'L'),(1,'R')]:
    for k in range(3):
        x=s*(.121+k*.004)
        tube(side+f'temple_wisp_{k}',[[s*.093,-.088,1.777],
             [x,-.076,1.706],[x+s*.007,-.042,1.631],[x-s*.006,-.054,1.586-k*.009]],
             [.001,.0015,.0003],'hair_light' if k==1 else 'hair',35,6,'hair')
    # Hair-line brow strokes and separated outer eyelashes.
    ex=s*.051
    for k in range(20):
        u=-.90+k*.087;x=ex+.028*u;z=1.710+.006*(1-u*u)+s*u*.001
        tube(side+f'_brow_hair_{k}',[[x,face_y(x,z)-.003,z-.002],
             [x+s*.0015,face_y(x,z)-.0035,z+.002]],
             [.00028,.00015],'brow',5,4,'face')
    for k in range(7):
        u=s*(.30+k*.093);x=ex+.0315*u
        z=1.677+s*u*.0016+.020*(max(0,1-u*u)**.7)
        y=face_y(x,z)-.0031
        tube(side+f'_lash_{k}',[[x,y,z],[x+s*.002,y-.002,z+.003],
             [x+s*.004,y-.001,z+.004]], [.00038,.00029,.00010],'brow',7,4,'face')


# ── The body under the clothes ───────────────────────────────────────────────
# Dasha 2.0 is a character, not one sculpted outfit: there is a body beneath
# every garment, cut into the regions a garment may cover. Nothing here is
# removed when cloth goes on — a covered region is hidden and comes back
# exactly as it was, so no sequence of changes can leave her missing a part of
# herself.
loft('bare_torso',[(1.000,.118,.074,0,0),(1.095,.120,.074,0,0),
     (1.16,.125,.080,0,0),(1.25,.140,.094,0,0),(1.32,.155,.086,0,.006),
     (1.37,.165,.064,0,.008),(1.399,.134,.054,0,.006),
     (1.424,.053,.041,0,.009)],'skin',44,64,'bare')
# One leg profile, cut into the regions a garment may cover. The cut sits
# below every published hem, so a skirt covers the top of what is visible
# instead of a hem and a region boundary each ending somewhere different.
BARE_LEG=[(.150,.048,.044,-.004),(.21,.049,.045,-.002),(.32,.051,.048,.002),
          (.49,.050,.050,.003),(.61,.052,.054,.004),(.78,.066,.064,.005),
          (.90,.076,.070,.003),(.99,.077,.071,0)]
def bare_leg(cx,low,high,scale=1.0):
    from scipy.interpolate import PchipInterpolator as _P
    sec=np.asarray([[z,rx,ry,cy] for z,rx,ry,cy in BARE_LEG])
    fit=_P(sec[:,0],sec[:,1:],axis=0)
    stops=sorted({low,high}|{z for z in sec[:,0] if low<z<high})
    return [(z,float(fit(z)[0])*scale,float(fit(z)[1])*scale,
             cx*float(np.interp(z,[.78,.99],[1,.78])) if z>.78 else cx,
             float(fit(z)[2])) for z in stops]
for s,side in [(-1,'L'),(1,'R')]:
    cx=s*.084
    loft(side+'_bare_shin',bare_leg(cx,.150,.61),'skin',24,48,'bare')
    loft(side+'_bare_thigh',bare_leg(cx,.59,.84),'skin',22,48,'bare')
    # The pelvis is the two leg tops merged, exactly the way the trousers merge
    # them, so the seam between a hidden hip and a visible thigh cannot open.
    hip=loft(side+'_bare_hip',bare_leg(cx,.82,.99),'skin',20,48,'bare')
    v=hip.vertices;z=v[:,2]
    sec=np.asarray(bare_leg(cx,.150,.99))
    cross=PchipInterpolator(sec[:,0],sec[:,1:],axis=0)(z)
    angle=np.arctan2((s*v[:,0]-s*cross[:,2])/cross[:,0],
                     -(v[:,1]-cross[:,3])/cross[:,1])
    blend=np.clip((z-.83)/.16,0,1);blend=blend*blend*(3-2*blend)
    v[:,0]=v[:,0]*(1-blend)+s*.128*np.maximum(0,np.sin(angle))*blend
    v[:,1]=v[:,1]*(1-blend)+(-.079*np.cos(angle))*blend
    v[:,2]+=blend*.062
    loft(side+'_bare_foot',[(0,.042,.096,cx,-.040),(.014,.048,.110,cx,-.043),
         (.038,.048,.107,cx,-.041),(.072,.045,.091,cx,-.028),
         (.112,.039,.064,cx,-.005),(.155,.033,.039,cx,.004)],'skin',24,48,'bare')
    for k,dx in enumerate([-.029,-.013,.002,.016,.028]):
        radius=.0112-.0016*k
        x=cx+s*dx;z=.014+.001*k
        tube(side+f'_bare_toe_{k}',[[x,-.124+.006*k,z],[x,-.135+.006*k,z+.001],
             [x,-.142+.006*k,z]],[radius*.9,radius,radius*.35],'skin',9,10,'bare')

# ── A second hairstyle ───────────────────────────────────────────────────────
# The same scalp surface carries both styles, so changing hair never changes
# the shape of her head. Loose length falls behind the shoulders and is bound
# to the head like the bun: no cloth or hair simulation is claimed here.
grid_mesh('loose_scalp',[[scalp(a,v,.001) for a in np.linspace(0,2*np.pi,112,endpoint=False)]
          for v in np.linspace(.002,1,58)],'hair',True,'hair',reverse=True)
for k,a in enumerate(np.linspace(1.28,2*np.pi-1.28,34)):
    crown=scalp(a,1,.003)
    fall=[]
    for tt in np.linspace(0,1,5):
        fall.append([crown[0]*(1-.22*tt)+.004*np.sin(6*tt+k),
                     crown[1]+.030*tt+.052*tt*tt,
                     crown[2]-(crown[2]-1.305)*tt])
    strip(f'loose_lock_{k:02d}',fall,[.006,.020,.025,.020,.007],.004,
          ['hair','hair_light','hair','hair_shadow'][k%4],
          (np.sin(a),-np.cos(a),.20),40,'hair',8)
for s,side in [(-1,'L'),(1,'R')]:
    for k in range(3):
        x=s*(.118+k*.005)
        tube(side+f'_loose_wisp_{k}',[[s*.090,-.086,1.779],[x,-.070,1.700],
             [x+s*.008,-.030,1.618],[x+s*.004,.020,1.545-k*.014]],
             [.0012,.0018,.0004],'hair_light' if k==1 else 'hair',35,6,'hair')

# ── A second top ─────────────────────────────────────────────────────────────
loft('shell_top',[(1.020,.120,.077,0,0),(1.10,.123,.078,0,0),
     (1.18,.128,.083,0,0),(1.26,.145,.097,0,0),(1.32,.159,.089,0,.006),
     (1.36,.166,.070,0,.008),(1.382,.150,.062,0,.006)],'trouser',40,64,'clothing')

# ── A second bottom, and a dress that is the whole garment ───────────────────
loft('skirt_shell',[(.60,.150,.128,0,.004),(.72,.135,.113,0,.004),
     (.84,.122,.096,0,.002),(.95,.117,.082,0,0),(1.030,.127,.081,0,0),
     (1.062,.132,.084,0,0)],'charcoal',44,64,'clothing')
loft('skirt_waistband',[(1.028,.129,.082,0,0),(1.056,.135,.086,0,0),
     (1.066,.131,.083,0,0)],'charcoal',8,64,'clothing')
loft('shift_shell',[(.585,.144,.122,0,.004),(.74,.128,.106,0,.004),
     (.86,.119,.092,0,.002),(.97,.115,.080,0,0),(1.06,.118,.077,0,0),
     (1.16,.124,.081,0,0),(1.25,.140,.094,0,0),(1.31,.152,.086,0,.006),
     (1.36,.158,.066,0,.008),(1.386,.140,.058,0,.006)],'indigo',60,64,'clothing')

# ── A second pair of shoes ───────────────────────────────────────────────────
for s,side in [(-1,'L'),(1,'R')]:
    cx=s*.084
    loft(side+'_sneaker_upper',[(.026,.050,.112,cx,-.048),(.042,.057,.125,cx,-.052),
         (.070,.058,.120,cx,-.049),(.098,.055,.100,cx,-.030),
         (.130,.048,.070,cx,-.004),(.168,.040,.045,cx,.008)],'canvas',32,48,'shoes')
    loft(side+'_sneaker_sole',[(0,.050,.114,cx,-.049),(.012,.059,.128,cx,-.052),
         (.030,.060,.129,cx,-.052),(.044,.056,.123,cx,-.050)],'rubber',10,48,'shoes')
    tube(side+'_sneaker_toe',[[cx-.042,-.100,.055],[cx,-.116,.062],
         [cx+.042,-.100,.055]],[.018,.020,.018],'rubber',20,10,'shoes',.75)
    for k in range(4):
        z=.096+k*.020
        tube(side+f'_sneaker_lace_{k}',[[cx-.030,-.060+k*.010,z],
             [cx,-.070+k*.010,z+.008],[cx+.030,-.060+k*.010,z]],
             [.0022,.0022],'lace_cord',18,6,'shoes')
    loft(side+'_sneaker_sock',[(.130,.032,.036,cx,.004),(.20,.035,.038,cx,.004),
         (.245,.033,.037,cx,.004)],'cotton',12,32,'shoes')

# ── Which part of the character each piece of geometry belongs to ────────────
# Routing is a table rather than a build order, so the geometry above stays
# readable as anatomy and tailoring while the character it composes is
# declared in one place. A part that matches no rule stops the build: geometry
# that quietly belonged to nothing would be geometry nobody could ever see.
import json
WARDROBE_TABLE=json.loads((Path(__file__).resolve().parent/'wardrobe.json').read_text())
BODY_REGIONS=WARDROBE_TABLE['always_visible']+WARDROBE_TABLE['body_regions']
WARDROBE=[item['id'] for item in WARDROBE_TABLE['items']]

def route(name,group):
    if name.endswith('_earring'):return 'wear:accessory/earrings-silver','head'
    if group=='hair':
        loose=name.startswith('loose_') or '_loose_' in name
        return ('wear:hair/loose-long' if loose else 'wear:hair/swept-bun'),'head'
    if name=='neck':return 'body:head','neck'
    if group in ('head','face'):return 'body:head','head'
    if group=='hands':return 'body:hands','hand'
    if '_upper_arm' in name:return 'body:upper_arms','arm'
    if '_lower_arm' in name:return 'body:lower_arms','arm'
    if name=='bare_torso':return 'body:torso','torso'
    if '_bare_hip' in name:return 'body:hips','leg'
    if '_bare_thigh' in name:return 'body:upper_legs','leg'
    if '_bare_shin' in name:return 'body:lower_legs','leg'
    if '_bare_foot' in name or '_bare_toe_' in name:return 'body:feet','foot'
    if '_sneaker_' in name:return 'wear:shoes/sneakers-white','foot'
    if '_shoe_' in name or name.endswith('_sock'):return 'wear:shoes/loafers-black','foot'
    if name=='shell_top':return 'wear:top/shell-ecru','torso'
    if 'skirt_' in name:return 'wear:bottom/skirt-charcoal','torso'
    if name=='shift_shell':return 'wear:dress/shift-indigo','torso'
    if name.endswith('_short_sleeve') or name.endswith('_shoulder'):
        return 'wear:top/tee-black','arm'
    if name in ('overshirt_shell','neck_binding'):return 'wear:top/tee-black','torso'
    if name.endswith('_leg') or 'jogger' in name:return 'wear:bottom/trousers-ecru','leg'
    if (name in ('waistband','fly_seam','waist_button')
            or '_pocket' in name or '_belt_loop' in name):
        return 'wear:bottom/trousers-ecru','torso'
    raise ValueError('unrouted part: %s (%s)' % (name,group))

ORDER=['body:'+region for region in BODY_REGIONS]+['wear:'+item for item in WARDROBE]
BUCKETS={key:[] for key in ORDER}
for name,mesh,material,group in PARTS:
    node,family=route(name,group)
    BUCKETS[node].append((name,mesh,material,group,family))
GROUPS=[(key,
         'body-region' if key.startswith('body:') else 'wardrobe-item',
         key.split(':',1)[1],
         BUCKETS[key]) for key in ORDER]

# Nothing may be published as wearable without geometry, and no geometry may
# be routed to a node the wardrobe never offers: an item a person could choose
# and never see is the same defect as a garment nobody can reach.
for key,_,semantic,parts in GROUPS:
    if not parts:
        raise ValueError('wardrobe entry with no geometry: '+key)
for item in WARDROBE_TABLE['items']:
    for region in item['hides']:
        if region not in WARDROBE_TABLE['body_regions']:
            raise ValueError('%s hides an unpublished region: %s'%(item['id'],region))
for slot,worn in WARDROBE_TABLE['default_outfit'].items():
    for item_id in ([worn] if isinstance(worn,str) else worn):
        if item_id not in WARDROBE:
            raise ValueError('default outfit wears an unpublished item: '+item_id)

SKELETON=LANDMARKS.skeleton()
export_modular_avatar(GROUPS,PALETTE,SKELETON,OUT,'dasha-v2-study',
                      version=WARDROBE_TABLE['asset_version'],wardrobe=WARDROBE_TABLE)
