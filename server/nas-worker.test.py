"""Isolated protocol tests. Never connects to a real server or needs credentials."""
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('nas_worker',pathlib.Path(__file__).with_name('nas-worker.py'))
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class Field:
    def __init__(self,value): self.value=value
    def get_value(self): return self.value


class ProtocolTest(unittest.TestCase):
    def setUp(self):
        self.opened=[];self.closed=[];self.link=False;self.queried=0;self.total=2;self.data=b"synthetic body";self.reads=0;self.document_link=False;self.file_size=None
        test=self
        class Connection:
            def __init__(self,uid,host,port,require_signing):test.assertTrue(require_signing);test.assertEqual(port,445)
            def connect(self,timeout):pass
            def disconnect(self):pass
        class Session:
            def __init__(self,connection,username,password,require_encryption,auth_protocol):test.assertTrue(require_encryption);test.assertEqual(auth_protocol,'ntlm')
            def connect(self):pass
        class TreeConnect:
            is_dfs_share=False
            def __init__(self,session,path):test.assertEqual(path,'\\\\192.168.1.10\\研发')
            def connect(self):pass
        class NoMoreFiles(Exception):pass
        class NoSuchFile(Exception):pass
        class Open:
            def __init__(self,tree,path):
                self.path=path;self.is_file=path.endswith('.txt');self.file_attributes=0x400 if (test.link and path) or (test.document_link and self.is_file) else 0
                self.end_of_file=len(test.data) if test.file_size is None else test.file_size;self.last_write_time=None
            def create(self,*args):
                test.assertEqual(args[1],0x81)  # LIST_DIRECTORY + READ_ATTRIBUTES; no write/read-file API.
                test.assertEqual(args[3],1)  # FILE_SHARE_READ only; no DELETE/WRITE replacement.
                test.assertEqual(args[4],1)  # OPEN existing, never CREATE.
                test.assertEqual(args[5],0x200040 if self.is_file else 0x200001)  # DIRECTORY + OPEN_REPARSE_POINT.
                test.opened.append(self.path)
            def close(self):test.closed.append(self.path)
            def read(self,offset,length):
                test.reads+=1;test.assertLessEqual(length,65536);return test.data[offset:offset+length]
            def query_directory(self,pattern,info,flags):
                test.queried+=1
                if test.queried>1:raise NoMoreFiles()
                return [{k:Field(v) for k,v in {'file_name':('资料'+str(i)).encode('utf-16-le'),'file_attributes':0x10,'end_of_file':0,'last_write_time':None}.items()} for i in range(test.total)]
        self.modules={
            'smbprotocol.connection':types.SimpleNamespace(Connection=Connection),
            'smbprotocol.session':types.SimpleNamespace(Session=Session),
            'smbprotocol.tree':types.SimpleNamespace(TreeConnect=TreeConnect),
            'smbprotocol.open':types.SimpleNamespace(Open=Open,CreateOptions=types.SimpleNamespace(FILE_DIRECTORY_FILE=1,FILE_OPEN_REPARSE_POINT=0x200000,FILE_NON_DIRECTORY_FILE=0x40),CreateDisposition=types.SimpleNamespace(FILE_OPEN=1),FileAttributes=types.SimpleNamespace(FILE_ATTRIBUTE_DIRECTORY=16,FILE_ATTRIBUTE_REPARSE_POINT=0x400,FILE_ATTRIBUTE_NORMAL=0x80),ImpersonationLevel=types.SimpleNamespace(Impersonation=2),FilePipePrinterAccessMask=types.SimpleNamespace(FILE_READ_DATA=1,FILE_READ_ATTRIBUTES=0x80),DirectoryAccessMask=types.SimpleNamespace(FILE_LIST_DIRECTORY=1,FILE_READ_ATTRIBUTES=0x80),ShareAccess=types.SimpleNamespace(FILE_SHARE_READ=1),QueryDirectoryFlags=types.SimpleNamespace(SMB2_RESTART_SCANS=1)),
            'smbprotocol.file_info':types.SimpleNamespace(FileInformationClass=types.SimpleNamespace(FILE_ID_BOTH_DIRECTORY_INFORMATION=1)),
            'smbprotocol.exceptions':types.SimpleNamespace(NoMoreFiles=NoMoreFiles,NoSuchFile=NoSuchFile),
        }
        self.request={'host':'192.168.1.10','share':'研发','username':'fixture','password':'fixture','basePath':'公开','path':'素材','search':''}
    def run_worker(self):
        with patch.dict(sys.modules,self.modules):return worker.run(self.request)
    def test_read_only_parent_handles_and_cleanup(self):
        result=self.run_worker();self.assertEqual(self.opened,['','公开','公开\\素材']);self.assertEqual(self.closed,list(reversed(self.opened)));self.assertEqual(len(result['entries']),2)
    def test_symlink_blocks_before_directory_enumeration(self):
        self.link=True;self.assertEqual(self.run_worker(),{'error':'LINK_BLOCKED'});self.assertEqual(self.queried,0);self.assertEqual(self.closed,list(reversed(self.opened)))
    def test_listing_is_bounded(self):
        self.total=501;result=self.run_worker();self.assertEqual(len(result['entries']),500);self.assertTrue(result['truncated'])
    def test_escape_is_rejected_before_connect(self):
        for path in ['../x','a/..','a\\b','a//b','/x','a:stream']:
            self.request['path']=path
            with self.assertRaises(ValueError):self.run_worker()
        self.assertEqual(self.opened,[])
    def test_document_read_uses_existing_file_read_flags_and_parent_pins(self):
        import base64
        self.request.update(operation='read',path='素材/说明.txt');self.data=b'x'*70000
        result=self.run_worker();self.assertEqual(base64.b64decode(result['data']),self.data);self.assertEqual(self.reads,2)
        self.assertEqual(self.opened,['','公开','公开\\素材','公开\\素材\\说明.txt']);self.assertEqual(self.closed,list(reversed(self.opened)))
    def test_document_link_and_size_are_rejected_before_read(self):
        self.request.update(operation='read',path='说明.txt');self.document_link=True
        self.assertEqual(self.run_worker(),{'error':'LINK_BLOCKED'});self.assertEqual(self.reads,0)
        self.document_link=False;self.file_size=10*1024*1024+1
        self.assertEqual(self.run_worker(),{'error':'DOCUMENT_TOO_LARGE'});self.assertEqual(self.reads,0)
    def test_document_extension_and_operation_are_restricted(self):
        self.request.update(operation='read',path='setup.exe');self.assertEqual(self.run_worker(),{'error':'UNSUPPORTED_DOCUMENT'});self.assertEqual(self.opened,[])
        self.request['operation']='write'
        with self.assertRaises(ValueError):self.run_worker()
    def test_non_lan_host_rejected(self):
        self.request['host']='127.0.0.1'
        with self.assertRaises(ValueError):self.run_worker()


if __name__=='__main__':unittest.main()
