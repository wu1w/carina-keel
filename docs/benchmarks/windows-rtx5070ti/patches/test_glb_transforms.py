"""CPU-only deployment-candidate regression tests; no claim of Windows deployment."""
import importlib.util
import json
import math
from pathlib import Path
import struct
import tempfile
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('candidate', Path(__file__).with_name('glb_loader.py'))
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class GlbTransforms(unittest.TestCase):
    def test_rotation_precedes_scaled_axes_and_normals_use_inverse_transpose(self):
        positions = np.array([[1,1,0],[0,0,0],[1,0,0]], dtype='<f4')
        normals = np.tile(np.array([[1,1,0]], dtype='<f4'), (3,1))
        binary = positions.tobytes() + normals.tobytes()
        document = {'asset':{'version':'2.0'},'buffers':[{'byteLength':len(binary)}],
            'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':36},{'buffer':0,'byteOffset':36,'byteLength':36}],
            'accessors':[{'bufferView':i,'componentType':5126,'count':3,'type':'VEC3'} for i in [0,1]],
            'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':1}}]}],
            'nodes':[{'mesh':0,'translation':[1,2,3],'rotation':[0,0,math.sqrt(0.5),math.sqrt(0.5)],'scale':[2,3,1]}],
            'scenes':[{'nodes':[0]}],'scene':0}
        text=json.dumps(document).encode();text+=b' '*((-len(text))%4)
        glb=struct.pack('<III',0x46546c67,2,12+8+len(text)+8+len(binary))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(binary),0x004e4942)+binary
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'transforms.glb';path.write_bytes(glb)
            vertices=loader.load_glb(path)['meshes'][0]['interleaved']
        np.testing.assert_allclose(vertices[0,:3],[-2,4,3],atol=1e-6)
        normal=np.array([-1/3,1/2,0]);normal/=np.linalg.norm(normal)
        np.testing.assert_allclose(vertices[0,5:8],normal,atol=1e-6)

    def test_interleaved_last_element_needs_no_trailing_stride_padding(self):
        data=struct.pack('<4f',1,2,3,99)+struct.pack('<4f',4,5,6,99)+struct.pack('<3f',7,8,9)
        document={'accessors':[{'bufferView':0,'count':3,'componentType':5126,'type':'VEC3'}],
                  'bufferViews':[{'buffer':0,'byteLength':44,'byteStride':16}]}
        values=loader._read_accessor(document,[data],0)
        np.testing.assert_array_equal(values,[[1,2,3],[4,5,6],[7,8,9]])


if __name__ == '__main__':
    unittest.main()
