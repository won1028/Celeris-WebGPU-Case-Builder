import unittest, json, zipfile, io, math
from engine import build, export_zip, wave_length

def settings():
    return dict(schemaVersion=1,nx=80,ny=60,lx=160,ly=120,terrain='flat',depth=10,slope=.05,position=.5,height=5,width=20,cx=.5,cy=.5,terrainAngle=0,breakwaters=[],boundary='west',direction=0,waveMode='period',waveInput=8,waveHeight=1,phase=0,solver=1,courant=.15,friction=.02,otherBoundary='sponge')

class EngineTests(unittest.TestCase):
    def test_dispersion(self):
        for h in [.01,1,10,1000]:
            for t in [1,8,100]:
                k=2*math.pi/wave_length(t,h)
                self.assertAlmostEqual(9.81*k*math.tanh(k*h),(2*math.pi/t)**2,places=9)
    def test_roundtrip_files(self):
        s=settings();r=build(s)
        z=zipfile.ZipFile(io.BytesIO(export_zip(s)))
        self.assertEqual(set(z.namelist()),{'bathy.txt','waves.txt','config.json','case_settings.json','validation_report.json'})
        rows=[list(map(float,line.split())) for line in z.read('bathy.txt').decode().splitlines()]
        self.assertEqual(len(rows),60);self.assertEqual(len(rows[0]),80)
        self.assertEqual(rows[0][0],-10)
        cfg=json.loads(z.read('config.json'));self.assertEqual(cfg['dx'],2);self.assertEqual(cfg['base_depth'],10)
        self.assertEqual(cfg['west_boundary_type'],2);self.assertEqual(cfg['incident_wave_type'],-1)
        waves=z.read('waves.txt').decode().strip().splitlines();self.assertEqual(waves[0],'[NumberOfWaves] 1')
        self.assertEqual(list(map(float,waves[2].split())),[.5,8,0,0])
        self.assertEqual(build(json.loads(z.read('case_settings.json')))['z'],r['z'])
    def test_terrain_shapes(self):
        for terrain in ['flat','slope','step','terrace','bar','channel','island']:
            s=settings();s['terrain']=terrain;r=build(s)
            self.assertEqual(len(r['z']),4800);self.assertTrue(all(math.isfinite(z) for z in r['z']))
    def test_orientation_and_step(self):
        s=settings();s.update(terrain='step',height=12,terrainAngle=90)
        r=build(s);self.assertEqual(r['z'][0],-10);self.assertEqual(r['z'][-1],2)
        self.assertTrue(r['errors']);s.update(boundary='south',direction=90);self.assertFalse(build(s)['errors'])
    def test_outward(self):
        s=settings();s['direction']=180
        self.assertTrue(build(s)['errors'])
        with self.assertRaises(ValueError):export_zip(s)
    def test_breakwater(self):
        s=settings();b=dict(enabled=True,i=40,j=30,length=40,thickness=8,angle=90,crest=-2);s['breakwaters']=[b]
        r=build(s);self.assertEqual(r['z'][30*80+40],-2);self.assertFalse(r['errors'])
        b['i']=1;self.assertTrue(build(s)['errors'])
        b['enabled']=False;self.assertFalse(build(s)['errors'])
    def test_dry_and_trough(self):
        s=settings();s.update(terrain='step',position=0,height=11)
        self.assertTrue(build(s)['errors'])
        s=settings();s['waveHeight']=21;self.assertTrue(build(s)['errors'])
    def test_length_input(self):
        s=settings();r=build(s);s.update(waveMode='length',waveInput=r['L']);self.assertAlmostEqual(build(s)['T'],8)
    def test_invalid_numbers(self):
        for key,value in [('nx',1.5),('ny',float('nan')),('lx',0),('waveInput',-1),('depth',float('inf'))]:
            s=settings();s[key]=value
            with self.assertRaises(ValueError):build(s)
    def test_grid_without_artificial_caps(self):
        s=settings();s.update(nx=2050,ny=512)
        r=build(s)
        self.assertEqual(len(r['z']),2050*512)
        self.assertFalse(r['errors'])
        self.assertFalse(r['warnings'])

if __name__=='__main__':unittest.main()
