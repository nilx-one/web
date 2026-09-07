# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Sky study 01 — editable procedural sculpture, not a biometric reconstruction.

Run: python build_model.py --output DIRECTORY
Dependencies: numpy, scipy, trimesh, pygltflib. Z-up authoring; Y-up glTF export.
Companion piece to "Dasha — study 01"; same helper library, same export contract.
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

parser=argparse.ArgumentParser(); parser.add_argument('--output',default='../sky-3d-output'); args=parser.parse_args()
OUT=Path(args.output).resolve(); OUT.mkdir(parents=True,exist_ok=True)
PARTS=[]
PALETTE={
 'skin':('#dcae94',.66,0), 'skin_shadow':('#bd8873',.73,0),
 'lip':('#a86a63',.50,0), 'lip_dark':('#7b4741',.66,0),
 'brow':('#5b4634',.82,0), 'eye_white':('#ece5da',.34,0),
 'iris':('#7c8a83',.40,0), 'iris_edge':('#4a564f',.48,0), 'pupil':('#161b1a',.24,0),
 'hair':('#6f5539',.62,0), 'hair_light':('#8b6d4a',.58,0), 'hair_fade':('#5d4830',.70,0),
 'anorak':('#d5a02c',.78,0), 'anorak_shadow':('#b6841f',.80,0), 'rib':('#c08a1c',.86,0),
 'navy':('#232b3d',.84,0),
 'jogger':('#c6c7c3',.92,0), 'jogger_shadow':('#a5a7a4',.94,0),
 'shoe':('#1b1e21',.55,0), 'shoe_white':('#ecebe4',.62,0), 'rubber':('#101316',.80,0),
 'silver':('#c1c6c9',.24,.86), 'cord':('#2c3238',.88,0)
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

def torus(name,center,major,minor,mat,group='details',rotation=None):
    m=trimesh.creation.torus(major_radius=major,minor_radius=minor,major_sections=64,minor_sections=12)
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi/2,[1,0,0]))
    if rotation is not None:m.apply_transform(rotation)
    m.vertices+=center;return add(name,m.vertices,m.faces,mat,group)

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
# Low-top trainers: black upper, white midsole, dark outsole. Weight is
# carried slightly on the left foot, so the two sides are not mirror-equal.
for side,cx,cy,lean in [('L',-.090,.012,.000),('R',.096,-.030,.004)]:
    loft(side+'_shoe_outsole',[(.004,.046,.118,cx,cy-.040),(.008,.051,.127,cx,cy-.043),(.014,.052,.130,cx,cy-.045),(.020,.051,.128,cx,cy-.045)],'rubber',14,64,'shoes')
    loft(side+'_shoe_midsole',[(.019,.051,.128,cx,cy-.045),(.026,.052,.130,cx,cy-.045),(.034,.051,.126,cx,cy-.044),(.040,.048,.120,cx,cy-.042)],'shoe_white',16,64,'shoes')
    loft(side+'_shoe_upper',[(.038,.048,.121,cx,cy-.042),(.052,.050,.126,cx,cy-.045),(.072,.050,.124,cx,cy-.046),(.094,.047,.106,cx,cy-.030),(.114,.043,.076,cx,cy-.010),(.134,.040,.052,cx,cy+.004)],'shoe',44,64,'shoes')
    tube(side+'_shoe_collar',[[cx+.040*np.sin(a),cy+.004-.052*np.cos(a),.136] for a in np.linspace(0,2*np.pi,20)],[.0035,.0035],'shoe',60,10,'shoes')
    ellipsoid(side+'_shoe_heel_tab',[cx,cy+.050,.128],[.016,.006,.011],'shoe_white','shoes')
    # Tongue and three eyelet-row laces across the instep.
    panel(side+'_shoe_tongue',[[cx-.024,cy-.062,.128],[cx+.024,cy-.062,.128],[cx+.020,cy-.086,.088],[cx-.020,cy-.086,.088]],'shoe','shoes',.004)
    for k,(zz,yy,ww) in enumerate([(.124,-.066,.026),(.108,-.076,.023),(.092,-.084,.019)]):
      tube(side+f'_shoe_lace_{k}',[[cx-ww,cy+yy+.006,zz-.004],[cx,cy+yy-.004,zz],[cx+ww,cy+yy+.006,zz-.004]],[.0022,.0026,.0022],'shoe_white',24,8,'shoes')
    tube(side+'_shoe_swoosh',[[cx+.049*lean-.001,cy-.052,.070],[cx+.046,cy-.010,.062],[cx+.040,cy+.030,.078]],[.0016,.0030,.0012],'shoe_white',30,8,'shoes')

# ---------------------------------------------------------------- joggers
# Loose marl sweatpants: gathered ankle cuff, relaxed thigh, seat merging
# across the centre line where both lofts overlap under the jacket hem.
for side,cx,cy in [('L',-.090,.012),('R',.096,-.030)]:
    LEG=[(.150,.050,.053,cx,cy),(.205,.058,.061,cx,cy),(.330,.068,.072,cx,cy),(.520,.078,.082,cx,cy+.002),(.700,.086,.090,cx,cy+.004),(.860,.093,.095,cx*.93,cy+.008),(.940,.098,.096,cx*.80,cy*.5+.006),(1.010,.098,.090,cx*.55,cy*.3+.006),(1.040,.092,.084,cx*.40,cy*.2+.006)]
    loft(side+'_jogger_leg',LEG,'jogger',62,72,'clothing')
    loft(side+'_jogger_cuff',[(.136,.050,.053,cx,cy),(.150,.056,.059,cx,cy),(.184,.056,.059,cx,cy),(.198,.049,.052,cx,cy)],'jogger_shadow',18,64,'clothing')
    # Two soft break lines, sampled on the lofted surface so they stay in contact.
    for tag,ang,zs in [('a',-.62,(.250,.430,.640)),('b',.55,(.310,.520,.740))]:
      pts=[surf_pt(LEG,z,ang+.10*np.sin(i*2.1),-.0016) for i,z in enumerate(zs)]
      tube(side+'_jogger_break_'+tag,pts,[.0013,.0024,.0012],'jogger_shadow',34,8,'clothing')
    sgn=-1 if side=='L' else 1
    pts=[surf_pt(LEG,z,sgn*np.pi/2,-.0012) for z in (.230,.560,.900)]
    tube(side+'_jogger_side_seam',pts,[.0009,.0011,.0009],'jogger_shadow',40,6,'clothing')
# Drawcord peeking below the jacket hem.
tube('waist_cord',[[-.026,-.088,1.000],[-.014,-.095,.964],[.002,-.090,.976]],[.0022,.0022],'cord',26,8,'details')
tube('waist_cord_b',[[.022,-.086,.998],[.032,-.093,.962],[.044,-.088,.978]],[.0022,.0022],'cord',26,8,'details')

# ---------------------------------------------------------------- neck
loft('neck',[(1.424,.078,.060,0,.006),(1.478,.057,.050,0,.008),(1.542,.049,.046,0,.008),(1.596,.055,.047,0,.008),(1.648,.066,.052,0,.008)],'skin',54,64,'head')

# ---------------------------------------------------------------- anorak
# Pullover half-zip windbreaker: closed body, funnel collar, packed hood.
coat=[(1.018,.180,.112,0,0),(1.040,.192,.118,0,0),(1.132,.184,.114,0,0),(1.242,.186,.115,0,.001),
      (1.340,.196,.120,0,.003),(1.430,.203,.118,0,.005),(1.487,.196,.106,0,.007),
      (1.514,.176,.090,0,.008),(1.535,.098,.064,0,.008),(1.545,.072,.054,0,.008)]
loft('anorak_shell',coat,'anorak',96,104,'clothing')
loft('anorak_hem_band',[(1.004,.176,.109,0,0),(1.016,.184,.114,0,0),(1.034,.185,.115,0,0),(1.046,.179,.111,0,0)],'rib',18,88,'clothing')
loft('anorak_collar',[(1.506,.090,.062,0,.008),(1.526,.078,.057,0,.008),(1.550,.073,.054,0,.008),(1.561,.070,.052,0,.008)],'anorak',18,72,'clothing')
loft('anorak_collar_lining',[(1.513,.072,.052,0,.008),(1.550,.066,.048,0,.008),(1.559,.064,.047,0,.008)],'navy',14,64,'clothing')

# Hood packed down behind the collar; navy lining shows at the opening.
ellipsoid('hood_body',[0,.090,1.482],[.114,.070,.080],'anorak','clothing')
ellipsoid('hood_lining',[0,.072,1.494],[.094,.052,.062],'navy','clothing')
tube('hood_rim',[[.102*np.sin(a),.072-.056*np.cos(a),1.520+.020*np.cos(a)] for a in np.linspace(0,2*np.pi,26)],[.0052,.0052],'anorak',60,12,'clothing')
tube('hood_cord_L',[[-.030,-.028,1.524],[-.036,-.046,1.480],[-.030,-.052,1.442]],[.0018,.0018],'cord',26,8,'details')
tube('hood_cord_R',[[.034,-.026,1.524],[.040,-.044,1.482],[.034,-.050,1.446]],[.0018,.0018],'cord',26,8,'details')

# Half zip, opened to mid-chest: placket, teeth, slider, pull.
zip_path=[surf_pt(coat,z,0,-.0016) for z in (1.545,1.512,1.466,1.412,1.372)]
strip('zip_placket',zip_path,[.020,.024,.026,.026,.024],.0030,'anorak_shadow',(0,-1,0),46,'clothing',10)
tube('zip_teeth',[[p[0],p[1]-.0032,p[2]] for p in zip_path],[.0013,.0016,.0016,.0013],'silver',48,10,'details')
ellipsoid('zip_slider',[0,surf_pt(coat,1.386,0,-.0052)[1],1.386],[.0075,.0038,.0110],'silver','details')
torus('zip_pull',[0,surf_pt(coat,1.372,0,-.0060)[1],1.365],.0068,.0013,'silver','details')

# Kangaroo pocket: two slanted welts and a shallow front panel edge.
for s,label in [(-1,'L'),(1,'R')]:
    tube(label+'_pocket_welt',[surf_pt(coat,z,s*a,-.0015) for z,a in [(1.152,1.02),(1.112,.80),(1.068,.58)]],[.0020,.0030,.0016],'anorak_shadow',34,8,'clothing')
    tube(label+'_body_fold',[surf_pt(coat,z,s*a,-.0010) for z,a in [(1.362,1.02),(1.262,1.16),(1.168,1.04)]],[.0011,.0022,.0009],'anorak_shadow',36,8,'clothing')

# Sleeves, shoulder caps, cuffs, hands. Arms hang beside the hem.
for s,label in [(-1,'L'),(1,'R')]:
    shoulder=[s*.160,.006,1.422]; elbow=[s*.222,-.008,1.230]
    wrist=np.array([s*.214,-.032,1.012])
    tube(label+'_sleeve',[shoulder,[s*.200,.002,1.330],elbow,[s*.216,-.024,1.106],wrist],[.055,.066,.060,.051,.045],'anorak',68,44,'clothing',.97)
    ellipsoid(label+'_shoulder_cap',[s*.176,.006,1.424],[.058,.056,.040],'anorak','clothing')
    loft(label+'_cuff',[(.982,.041,.041,wrist[0],wrist[1]),(.998,.046,.046,wrist[0],wrist[1]),(1.024,.047,.047,wrist[0],wrist[1]),(1.038,.043,.043,wrist[0],wrist[1])],'rib',18,48,'clothing')
    palm=wrist+np.array([s*.001,-.004,-.044])
    ellipsoid(label+'_hand',palm,[.030,.020,.046],'skin','hands')
    for k in range(4):
      x=palm[0]+(k-1.5)*.0135
      base=np.array([x,palm[1]-.001,palm[2]-.026]);length=[.047,.058,.055,.044][k]
      end=base+np.array([s*.004,-.010,-length])
      tube(label+f'_finger_{k}',[base,base+[0,-.007,-length*.5],end],[.0070,.0064,.0038],'skin',20,12,'hands')
    thumb=palm+[-s*.026,-.007,.013]
    tube(label+'_thumb',[thumb,thumb+[-s*.013,-.005,-.022],thumb+[-s*.009,-.018,-.041]],[.0100,.0078,.0050],'skin',22,14,'hands')

# ---------------------------------------------------------------- head
# One continuous parametric surface. Squarer jaw, defined bridge and brow
# ridge; every feature below is a smooth additive deformation of the shell.
HZ=np.array([1.572,1.586,1.604,1.625,1.649,1.677,1.708,1.743,1.778,1.810,1.838,1.858,1.868])
HX=np.array([.010,.036,.059,.080,.094,.106,.114,.117,.114,.100,.073,.038,.002])
HY=np.array([.030,.055,.072,.087,.098,.109,.118,.124,.124,.112,.085,.048,.002])
RX=PchipInterpolator(HZ,HX);RY=PchipInterpolator(HZ,HY)
def gauss(x,z,xx,zz,wx,wz):return np.exp(-((x-xx)/wx)**2-((z-zz)/wz)**2)
def face_y(x,z):
    rx=float(RX(z));ry=float(RY(z));base=.008-ry*np.sqrt(max(0,1-(x/max(rx,.001))**2))
    d=0
    for s in [-1,1]:
      d-=.0080*gauss(x,z,s*.064,1.726,.028,.028)  # cheekbone
      d+=.0068*gauss(x,z,s*.060,1.695,.029,.022)  # cheek hollow
      d+=.0072*gauss(x,z,s*.047,1.750,.025,.016)  # eye socket
      d-=.0058*gauss(x,z,s*.046,1.775,.032,.012)  # brow ridge
      d-=.0075*gauss(x,z,s*.040,1.630,.026,.022)  # jaw corner
      d-=.0075*gauss(x,z,s*.0158,1.6985,.0074,.0098) # alar wing
    d-=.0095*gauss(x,z,0,1.748,.0165,.044)        # nasal bridge
    d-=.0165*gauss(x,z,0,1.7005,.0130,.0135)      # nose ball
    d+=.0025*gauss(x,z,0,1.656,.036,.020)         # mouth recess
    d+=.0030*gauss(x,z,0,1.680,.009,.010)         # philtrum
    d-=.0200*gauss(x,z,0,1.617,.030,.020)         # chin
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
    ellipsoid(label+'_ear',[s*.1155,.015,1.720],[.0135,.0105,.0295],'skin','head')
    ellipsoid(label+'_ear_inner',[s*.1215,.005,1.722],[.0060,.0042,.0175],'skin_shadow','head')
    strip(label+'_ear_helix',[[s*.113,-.006,1.742],[s*.126,.008,1.730],[s*.126,.024,1.712],[s*.116,.026,1.698]],[.0035,.0052,.0050,.0030],.0032,'skin',(s,0,.25),28,'head',10)
    ex=s*.0455;ez=1.750
    def eye_z(u,v,ez=ez,s=s):
      tilt=s*u*.0017
      return ez+tilt+(.0084 if v>=0 else .0066)*v*(max(0,1-u*u)**.7)
    def eye_y(x,z,u,v):return face_y(x,z)-.0017-.0029*(1-u*u)*(1-v*v)
    eye=[]
    for u in np.linspace(-1,1,40):
      row=[]
      for v in np.linspace(-1,1,20):
        x=ex+.0256*u;z=eye_z(u,v);row.append([x,eye_y(x,z,u,v),z])
      eye.append(row)
    grid_mesh(label+'_eye_white',eye,'eye_white',False,'face',reverse=True)
    for name,radius,mat,offset in [('iris_rim',.0091,'iris_edge',.0004),('iris',.0083,'iris',.0007),('pupil',.0040,'pupil',.0010)]:
      iris=[]
      for r in np.linspace(.00008,radius,16):
        row=[]
        for a in np.linspace(0,2*np.pi,48,endpoint=False):
          x=ex+r*np.cos(a);z=ez-.0004+r*np.sin(a);u=(x-ex)/.0256
          z=np.clip(z,eye_z(u,-1)+.00035,eye_z(u,1)-.00035)
          vy=(z-ez-s*u*.0017)/((.0084 if z>=ez else .0066)*max(1e-3,(1-u*u)**.7))
          row.append([x,eye_y(x,z,u,vy)-offset,z])
        iris.append(row)
      grid_mesh(label+'_'+name,iris,mat,True,'face',reverse=True)
    ellipsoid(label+'_eye_catchlight',[ex-.0023,face_y(ex,ez)-.0068,ez+.0028],[.00115,.00070,.00115],'eye_white','face')
    # A heavier upper lid keeps the gaze relaxed rather than wide.
    for name,vv,mat,rad in [('upper_lid',1,'skin',.0026),('lower_lid',-1,'skin_shadow',.00085),('upper_lash',1,'brow',.00050)]:
      pts=[]
      for u in np.linspace(-.98,.98,18):
        x=ex+.0256*u;z=eye_z(u,vv)+(.0004 if name=='upper_lash' else 0)
        pts.append([x,face_y(x,z)-.0024-(.0006 if name=='upper_lash' else 0),z])
      tube(label+'_'+name,pts,[rad*.5,rad,rad*.35],mat,40,10,'face')
    # Straight, level brow with a short taper — the male shape cue.
    browpts=[]
    for u in np.linspace(-1,1,12):
      x=ex+.0285*u;z=1.771+.0021*(1-u*u)+s*u*.0012
      browpts.append([x,face_y(x,z)-.0020,z])
    strip(label+'_brow',browpts,[.0025,.0068,.0063,.0015],.0011,'brow',(0,-1,0),36,'face',8)
    x=s*.0148;z=1.6905
    ellipsoid(label+'_nostril',[x,face_y(x,z)+.0013,z],[.0034,.0020,.0019],'skin_shadow','face')
    # Short sideburn in front of the ear, squared off at the tragus line.
    strip(label+'_sideburn',[[s*.106,-.024,1.780],[s*.112,-.016,1.752],[s*.110,-.012,1.726]],[.009,.013,.012],.0021,'hair_fade',(s,-.35,0),24,'hair',8)

# Lips: thinner upper, moderate lower, soft corners.
for upper in [True,False]:
    lip=[]
    for u in np.linspace(-1,1,65):
      row=[];x=.0345*u
      seam=1.656-.0021*(1-u*u)
      height=(.0053+.0015*np.exp(-((abs(u)-.28)/.16)**2)-.0009*np.exp(-(u/.12)**2)) if upper else .0074
      for v in np.linspace(0,1,15):
        z=seam+(1 if upper else -1)*height*(max(0,1-u*u)**.8)*v
        y=face_y(x,z)-(.0015+.0035*np.sin(np.pi*v*.95))*(1-u*u)
        row.append([x,y,z])
      lip.append(row)
    grid_mesh('upper_lip' if upper else 'lower_lip',lip,'lip',False,'face',reverse=upper)
mouth=[]
for u in np.linspace(-.99,.99,16):
  x=.0345*u;z=1.656-.0021*(1-u*u);mouth.append([x,face_y(x,z)-.0020,z])
tube('lip_line',mouth,[.0003,.00066,.0003],'lip_dark',45,8,'face')

# ---------------------------------------------------------------- hair
# Short textured crop over faded back and sides. Two shells: a tight skull
# layer for the fade, a thicker cap for the top section. The fade band
# collapses to zero height at the front, so no line crosses the forehead.
fade=[]
for v in np.linspace(.001,1,56):
  row=[]
  for a in np.linspace(0,2*np.pi,132,endpoint=False):
    aa=abs((a+np.pi)%(2*np.pi)-np.pi)
    top=float(np.interp(aa,[0.0,0.80,1.20,1.60,2.40,np.pi],[1.820,1.818,1.806,1.792,1.784,1.778]))
    bottom=float(np.interp(aa,[0.0,0.80,1.25,1.60,1.90,2.40,np.pi],[1.820,1.812,1.778,1.760,1.730,1.708,1.696]))
    z=top+(bottom-top)*v
    row.append([float(RX(min(z,1.867)))*1.030*np.sin(a),.008-float(RY(min(z,1.867)))*1.030*np.cos(a),z])
  fade.append(row)
grid_mesh('fade_shell',fade,'hair_fade',True,'hair',reverse=True)

# The top section is a thin cap, only ~7 mm proud of the skull at the
# temples; its lower edge is the visible hairline, cut with a slight
# temple recession rather than a level fringe.
CZ,RZ,SX,SY=1.748,.140,.125,.133
CAP=.0032  # the smooth shell is recessed; the locks form the outer surface
def hairline_z(aa):
    return float(np.interp(abs(aa),[0.0,0.45,0.85,1.25,1.60,2.40,np.pi],[1.812,1.809,1.818,1.798,1.784,1.778,1.772]))
cap=[]
for v in np.linspace(.001,1,64):
  row=[]
  for a in np.linspace(0,2*np.pi,150,endpoint=False):
    aa=abs((a+np.pi)%(2*np.pi)-np.pi);end=hairline_z(aa)
    phi=v*(np.arccos(np.clip((end-CZ)/RZ,-1,1)) if end>=CZ else np.pi/2)
    row.append([(SX-CAP)*np.sin(phi)*np.sin(a),.010-(SY-CAP)*np.sin(phi)*np.cos(a),CZ+(RZ-CAP)*np.cos(phi)])
  cap.append(row)
grid_mesh('crop_cap',cap,'hair',True,'hair',reverse=True)

# Short-crop texture: every lock is sampled on the cap surface and pushed
# out by two millimetres, so the hair follows the skull instead of floating
# in front of it. Locks stop short of the edge; the cap defines the hairline.
def cap_pt(aa,phi,push=.0):
    return [(SX+push)*np.sin(phi)*np.sin(aa),.010-(SY+push)*np.sin(phi)*np.cos(aa),CZ+(RZ+push)*np.cos(phi)]
def cap_end_phi(aa):
    return float(np.arccos(np.clip((hairline_z(aa)-CZ)/RZ,-1,1)))
for k,aa in enumerate(np.linspace(-np.pi+.08,np.pi-.08,34)):
    pe=cap_end_phi(aa);j=.0011*np.sin(k*2.7);w=.0245+.0035*np.sin(k*1.9)
    r0=.16+.10*abs(np.sin(k*1.31));pe2=pe*(.80+.10*abs(np.sin(k*1.7)))
    pts=[cap_pt(aa+.09*np.sin(k*2.2),r0,.0),cap_pt(aa,pe*.44,.0004),cap_pt(aa,pe*.72,.0005),cap_pt(aa,pe2+j*4,.0)]
    strip(f'crop_lock_{k:02d}',pts,[.0110,w,w*.97,w*.86],.0019,['hair','hair_light','hair','hair_light'][k%4],(np.sin(aa),-np.cos(aa),0),40,'hair',10)
# A handful of front pieces cross the hairline unevenly so the edge is not
# a clean curve; a couple of whorl pieces keep the crown from reading flat.
for k,aa in enumerate([-1.02,-.58,-.16,.30,.72,1.12]):
    pe=cap_end_phi(aa);j=[.030,.062,.018,.048,.026,.055][k]
    pts=[cap_pt(aa+.04,pe*.52,.0022),cap_pt(aa+.02,pe*.80,.0024),cap_pt(aa,pe+j,.0016)]
    strip(f'crop_flick_{k}',pts,[.0105,.0175,.0060],.0016,['hair_light','hair'][k%2],(np.sin(aa),-np.cos(aa),.20),30,'hair',10)
for k,aa in enumerate([-2.62,2.62]):
    pts=[cap_pt(aa,.05,.0020),cap_pt(aa+.40,.28,.0024),cap_pt(aa+.70,.56,.0018)]
    strip(f'crown_whorl_{k}',pts,[.0100,.0195,.0080],.0016,'hair_light',(np.sin(aa),-np.cos(aa),.4),28,'hair',10)

# ---------------------------------------------------------------- assembly
SKELETON = LANDMARKS.skeleton()
export_avatar(PARTS, PALETTE, SKELETON, LANDMARKS, OUT, "sky-study")
