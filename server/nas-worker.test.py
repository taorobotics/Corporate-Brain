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
        self.opened=[];self.closed=[];self.link=False;self.queried=0;self.total=2
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
            def __init__(self,tree,path):self.path=path;self.file_attributes=0x400 if test.link and path else 0
            def create(self,*args):
                test.assertEqual(args[1],0x81)  # LIST_DIRECTORY + READ_ATTRIBUTES; no write/read-file API.
                test.assertEqual(args[3],1)  # FILE_SHARE_READ only; no DELETE/WRITE replacement.
                test.assertEqual(args[4],1)  # OPEN existing, never CREATE.
                test.assertEqual(args[5],0x200001)  # DIRECTORY + OPEN_REPARSE_POINT.
                test.opened.append(self.path)
            def close(self):test.closed.append(self.path)
            def query_directory(self,pattern,info,flags):
                test.queried+=1
                if test.queried>1:raise NoMoreFiles()
                return [{k:Field(v) for k,v in {'file_name':('资料'+str(i)).encode('utf-16-le'),'file_attributes':0x10,'end_of_file':0,'last_write_time':None}.items()} for i in range(test.total)]
        self.modules={
            'smbprotocol.connection':types.SimpleNamespace(Connection=Connection),
            'smbprotocol.session':types.SimpleNamespace(Session=Session),
            'smbprotocol.tree':types.SimpleNamespace(TreeConnect=TreeConnect),
            'smbprotocol.open':types.SimpleNamespace(Open=Open,CreateOptions=types.SimpleNamespace(FILE_DIRECTORY_FILE=1,FILE_OPEN_REPARSE_POINT=0x200000),CreateDisposition=types.SimpleNamespace(FILE_OPEN=1),FileAttributes=types.SimpleNamespace(FILE_ATTRIBUTE_DIRECTORY=16,FILE_ATTRIBUTE_REPARSE_POINT=0x400),ImpersonationLevel=types.SimpleNamespace(Impersonation=2),DirectoryAccessMask=types.SimpleNamespace(FILE_LIST_DIRECTORY=1,FILE_READ_ATTRIBUTES=0x80),ShareAccess=types.SimpleNamespace(FILE_SHARE_READ=1),QueryDirectoryFlags=types.SimpleNamespace(SMB2_RESTART_SCANS=1)),
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
    def test_non_lan_host_rejected(self):
        self.request['host']='127.0.0.1'
        with self.assertRaises(ValueError):self.run_worker()


if __name__=='__main__':unittest.main()
