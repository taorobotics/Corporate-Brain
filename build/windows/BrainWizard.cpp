// Corporate Brain installer UI, MIT. Win32 only; no runtime dependency or NSIS-script timer.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commctrl.h>
struct Stack { Stack* next; wchar_t text[1]; };
static HWND host, primary, progress, percent, spinner, panel;
static HBITMAP frames[16];
static unsigned frame;
static const UINT_PTR timerId = 0xCB01;
static volatile LONG installPhase, cancelDecision;
static HWND stageText;
static LRESULT CALLBACK panelProc(HWND window,UINT message,WPARAM w,LPARAM l,UINT_PTR,DWORD_PTR) {
  if(message==WM_ERASEBKGND) {
    RECT r;GetClientRect(window,&r);
    HBRUSH mainBrush=CreateSolidBrush(RGB(251,250,248));
    FillRect(reinterpret_cast<HDC>(w),&r,mainBrush);DeleteObject(mainBrush);
    r.right=MulDiv(190,GetDpiForWindow(window),96);
    HBRUSH sideBrush=CreateSolidBrush(RGB(241,240,236));
    FillRect(reinterpret_cast<HDC>(w),&r,sideBrush);DeleteObject(sideBrush);
    if(GetPropW(window,L"Brain.ProgressPage")) {
      const int dpi=GetDpiForWindow(window);
      RECT card={MulDiv(222,dpi,96),MulDiv(232,dpi,96),MulDiv(872,dpi,96),MulDiv(457,dpi,96)};
      HBRUSH border=CreateSolidBrush(RGB(223,220,214));
      FrameRect(reinterpret_cast<HDC>(w),&card,border);DeleteObject(border);
    }
    return 1;
  }
  if(message==WM_NCDESTROY) {RemovePropW(window,L"Brain.ProgressPage");RemoveWindowSubclass(window,panelProc,1);}
  return DefSubclassProc(window,message,w,l);
}
static BOOL CALLBACK hideDefaultSurface(HWND window,LPARAM) {
  if(GetParent(window)==host) {
    wchar_t name[32];GetClassNameW(window,name,32);
    if(lstrcmpW(name,L"Static")==0)ShowWindow(window,SW_HIDE);
  }
  return TRUE;
}
static UINT_PTR popHandle(Stack** stack) {
  if (!*stack) return 0;
  Stack* item = *stack; UINT_PTR number = 0;
  const wchar_t* c=item->text;const bool negative=*c==L'-';if(negative)++c;
  for (; *c >= L'0' && *c <= L'9'; ++c) number = number * 10 + static_cast<unsigned>(*c - L'0');
  *stack = item->next; GlobalFree(item); return negative?0-number:number;
}
static void stopProgress() {
  KillTimer(host, timerId);
  if (IsWindow(spinner)) SendMessageW(spinner, STM_SETIMAGE, IMAGE_BITMAP, 0);
  for (unsigned i=0;i<16;++i) { if(frames[i]) DeleteObject(frames[i]); frames[i]=0; }
  progress=0; percent=0; spinner=0;
}
static void CALLBACK tick(HWND,UINT,UINT_PTR,DWORD) {
  if (!IsWindow(progress)) return;
  const LRESULT total = SendMessageW(progress, PBM_GETRANGE, FALSE, 0);
  const LRESULT position = SendMessageW(progress, PBM_GETPOS, 0, 0);
  if (total > 0) {
    wchar_t value[32]; wsprintfW(value,L"%u%%",static_cast<unsigned>(position*100/total));
    SetWindowTextW(percent,value);
  }
  frame=(frame+1)%16;
  if(frames[frame]) SendMessageW(spinner,STM_SETIMAGE,IMAGE_BITMAP,reinterpret_cast<LPARAM>(frames[frame]));
}
static LRESULT CALLBACK buttonProc(HWND window,UINT message,WPARAM w,LPARAM l,UINT_PTR,DWORD_PTR) {
  if(message==BM_SETSTYLE) w=(w & ~static_cast<WPARAM>(BS_TYPEMASK)) | BS_OWNERDRAW;
  return DefSubclassProc(window,message,w,l);
}
static LRESULT CALLBACK windowProc(HWND window,UINT message,WPARAM w,LPARAM l,UINT_PTR,DWORD_PTR) {
  if((message==WM_COMMAND && LOWORD(w)==IDCANCEL) || message==WM_CLOSE) {
    const LONG phase=InterlockedCompareExchange(&installPhase,0,0);
    if(phase==1) {
      if(InterlockedCompareExchange(&cancelDecision,0,0)!=0)return TRUE;
      InterlockedExchange(&cancelDecision,2);
      if(InterlockedCompareExchange(&installPhase,0,0)!=1) {
        InterlockedExchange(&cancelDecision,0);
        MessageBoxW(window,L"程序已进入写入阶段，请等待当前步骤结束。",L"公司大脑",MB_OK|MB_ICONINFORMATION);
        return TRUE;
      }
      const int answer=MessageBoxW(window,L"要取消本次安装吗？\r\n将等待当前安全步骤结束，清理临时文件，并保留已有对话与草稿。",L"公司大脑",MB_YESNO|MB_DEFBUTTON2|MB_ICONQUESTION);
      InterlockedExchange(&cancelDecision,answer==IDYES?1:0);
      if(answer==IDYES) {
        EnableWindow(GetDlgItem(window,IDCANCEL),FALSE);
        if(IsWindow(stageText))SetWindowTextW(stageText,L"正在等待解压结束，随后安全取消…");
      }
      return TRUE;
    }
    if(phase==2) {
      MessageBoxW(window,L"正在完成程序写入，请等待当前步骤结束。个人记录不会被清除。",L"公司大脑",MB_OK|MB_ICONINFORMATION);
      return TRUE;
    }
  }
  if(message==WM_DRAWITEM) {
    DRAWITEMSTRUCT* item=reinterpret_cast<DRAWITEMSTRUCT*>(l);
    if(item && item->hwndItem==primary) {
      const int savedDc=SaveDC(item->hDC);
      const bool disabled=(item->itemState & ODS_DISABLED)!=0;
      const COLORREF fill=disabled?RGB(226,224,219):((item->itemState & ODS_SELECTED)?RGB(161,88,61):RGB(183,108,78));
      HBRUSH brush=CreateSolidBrush(fill); HPEN pen=CreatePen(PS_SOLID,1,fill);
      HGDIOBJ oldBrush=SelectObject(item->hDC,brush), oldPen=SelectObject(item->hDC,pen);
      RoundRect(item->hDC,item->rcItem.left,item->rcItem.top,item->rcItem.right,item->rcItem.bottom,8,8);
      SelectObject(item->hDC,oldBrush); SelectObject(item->hDC,oldPen); DeleteObject(brush);DeleteObject(pen);
      wchar_t text[256]; GetWindowTextW(primary,text,256);
      HGDIOBJ oldFont=SelectObject(item->hDC,reinterpret_cast<HFONT>(SendMessageW(primary,WM_GETFONT,0,0)));
      SetBkMode(item->hDC,TRANSPARENT);SetTextColor(item->hDC,disabled?RGB(135,135,130):RGB(255,255,255));
      DrawTextW(item->hDC,text,-1,&item->rcItem,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
      SelectObject(item->hDC,oldFont);
      if(item->itemState & ODS_FOCUS) { RECT r=item->rcItem;InflateRect(&r,-4,-4);DrawFocusRect(item->hDC,&r); }
      RestoreDC(item->hDC,savedDc);
      return TRUE;
    }
  }
  if(message==WM_NCDESTROY) { stopProgress();RemoveWindowSubclass(window,windowProc,1); }
  return DefSubclassProc(window,message,w,l);
}
extern "C" void __cdecl Style(HWND parent,int,wchar_t*,Stack**,void*) {
  host=parent;primary=GetDlgItem(parent,1);
  EnumChildWindows(parent,hideDefaultSurface,0);
  SetWindowSubclass(parent,windowProc,1,0);
  SetWindowSubclass(primary,buttonProc,1,0);
  SendMessageW(primary,BM_SETSTYLE,BS_OWNERDRAW,TRUE);
}
extern "C" void __cdecl Center(HWND parent,int,wchar_t*,Stack**,void*) {
  if(!IsWindow(parent)) return;
  RECT windowRect;
  if(!GetWindowRect(parent,&windowRect)) return;
  const int width=windowRect.right-windowRect.left;
  const int height=windowRect.bottom-windowRect.top;
  HMONITOR monitor=MonitorFromWindow(parent,MONITOR_DEFAULTTONEAREST);
  MONITORINFO info;
  info.cbSize=sizeof(info);
  if(!GetMonitorInfoW(monitor,&info)) return;
  const RECT work=info.rcWork;
  const int x=work.left+((work.right-work.left)-width)/2;
  const int y=work.top+((work.bottom-work.top)-height)/2;
  SetWindowPos(parent,0,x,y,0,0,SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE);
}
extern "C" void __cdecl Panel(HWND,int,wchar_t*,Stack** stack,void*) {
  panel=reinterpret_cast<HWND>(popHandle(stack));
  SetWindowLongPtrW(panel,GWL_STYLE,GetWindowLongPtrW(panel,GWL_STYLE)|WS_CLIPCHILDREN);
  SetWindowSubclass(panel,panelProc,1,0);
  InvalidateRect(panel,0,TRUE);
}
static BOOL CALLBACK hideNativeControl(HWND window,LPARAM parent) {
  if(GetParent(window)==reinterpret_cast<HWND>(parent))ShowWindow(window,SW_HIDE);
  return TRUE;
}
extern "C" void __cdecl NativePage(HWND,int,wchar_t*,Stack** stack,void*) {
  HWND page=reinterpret_cast<HWND>(popHandle(stack));
  SetPropW(page,L"Brain.ProgressPage",reinterpret_cast<HANDLE>(1));
  EnumChildWindows(page,hideNativeControl,reinterpret_cast<LPARAM>(page));
}
extern "C" void __cdecl Prepare(HWND,int,wchar_t*,Stack** stack,void*) {
  stageText=reinterpret_cast<HWND>(popHandle(stack));
  InterlockedExchange(&cancelDecision,0);InterlockedExchange(&installPhase,1);
}
extern "C" void __cdecl Commit(HWND,int stringSize,wchar_t*,Stack** stack,void*) {
  InterlockedExchange(&installPhase,2);
  if(IsWindow(host))EnableWindow(GetDlgItem(host,IDCANCEL),FALSE);
  while(InterlockedCompareExchange(&cancelDecision,0,0)==2)Sleep(30);
  Stack* result=reinterpret_cast<Stack*>(GlobalAlloc(GPTR,sizeof(Stack)+stringSize*sizeof(wchar_t)));
  if(result) {
    result->text[0]=InterlockedCompareExchange(&cancelDecision,0,0)==1?L'0':L'1';
    result->next=*stack;*stack=result;
  }
}
extern "C" void __cdecl Complete(HWND,int,wchar_t*,Stack**,void*) {
  InterlockedExchange(&installPhase,0);
}
extern "C" void __cdecl Refresh(HWND parent,int,wchar_t*,Stack**,void*) {
  HWND window=IsWindow(parent)?parent:host;
  if(!IsWindow(window)) return;
  RedrawWindow(window,nullptr,nullptr,RDW_INVALIDATE|RDW_UPDATENOW|RDW_ALLCHILDREN);
  UpdateWindow(window);
}
extern "C" void __cdecl Progress(HWND parent,int,wchar_t*,Stack** stack,void*) {
  stopProgress();host=parent;
  progress=reinterpret_cast<HWND>(popHandle(stack));
  percent=reinterpret_cast<HWND>(popHandle(stack));
  spinner=reinterpret_cast<HWND>(popHandle(stack));
  if(!*stack) return;
  Stack* item=*stack;
  if(lstrlenW(item->text)<900) {
    wchar_t path[1024];
    for(unsigned i=0;i<16;++i) {
      wsprintfW(path,L"%s\\brain-spinner-%u.bmp",item->text,i);
      frames[i]=reinterpret_cast<HBITMAP>(LoadImageW(0,path,IMAGE_BITMAP,0,0,LR_LOADFROMFILE));
    }
  }
  *stack=item->next;GlobalFree(item);frame=0;
  tick(parent,0,0,0);SetTimer(parent,timerId,100,tick);
}
extern "C" void __cdecl Stop(HWND,int,wchar_t*,Stack**,void*) { stopProgress(); }
extern "C" void __cdecl Release(HWND,int,wchar_t*,Stack**,void*) {
  stopProgress();
  if(IsWindow(primary))RemoveWindowSubclass(primary,buttonProc,1);
  if(IsWindow(host))RemoveWindowSubclass(host,windowProc,1);
  if(IsWindow(panel))RemoveWindowSubclass(panel,panelProc,1);
}
BOOL WINAPI DllMain(HINSTANCE,DWORD,LPVOID) {return TRUE;}
