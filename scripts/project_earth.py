import sys, numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
src=np.asarray(Image.open(sys.argv[1]).convert("RGB")); out=sys.argv[2]
SH,SW=src.shape[:2]
W,H=2400,312; A=W/H
k=2.0; lat0=np.radians(-30); lon0=np.radians(25)
h=.684; c=A/2; R=(c*c+h*h)/(2*h)            # circle through the app's curve, in units of H
x,y=np.meshgrid((np.arange(W)+.5)/H-c,(np.arange(H)+.5)/H)
dx=x; dy=(.316+R)-y                          # up from sphere centre
r=np.minimum(np.hypot(dx,dy),R)
th=np.arcsin(r/R); psi=np.arctan2(dx,dy)
th2=np.pi/2-(np.pi/2-th)*k; psi2=psi*k       # k widens the visible area; foreshortening at the limb is kept
nx,ny,nz=np.sin(th2)*np.sin(psi2),np.sin(th2)*np.cos(psi2),np.cos(th2)
wy=ny*np.cos(lat0)+nz*np.sin(lat0); wz=-ny*np.sin(lat0)+nz*np.cos(lat0)
lat=np.arcsin(np.clip(wy,-1,1)); lon=lon0+np.arctan2(nx,wz)
u=((lon/(2*np.pi)+.5)%1*SW).astype(int)%SW; v=np.clip(((.5-lat/np.pi)*SH).astype(int),0,SH-1)
Image.fromarray(src[v,u]).save(out,quality=82)
