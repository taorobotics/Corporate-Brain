// Corporate Brain installer UI, MIT. Win32 only; no runtime dependency or NSIS-script timer.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commctrl.h>
struct Stack { Stack* next; wchar_t text[1]; };
static HWND host, primary, progress, percent, spinner, panel;
static HBITMAP frames[16];
static unsigned frame;
static const UINT_PTR timerId = 0xCB01;
static LRESULT CALLBACK panelProc(HWND window,UINT message,WPARAM w,LPARAM l,UINT_PTR,DWORD_PTR) {
  if(message==WM_ERASEBKGND) {
    RECT r;GetClientRect(window,&r);
    HBRUSH mainBrush=CreateSolidBrush(RGB(251,250,248));
    FillRect(reinterpret_cast<HDC>(w),&r,mainBrush);DeleteObject(mainBrush);
    r.right=MulDiv(190,GetDpiForWindow(window),96);
    HBRUSH sideBrush=CreateSolidBrush(RGB(241,240,236));
    FillRect(reinterpret_cast<HDC>(w),&r,sideBrush);DeleteObject(sideBrush);
    return 1;
  }
  if(message==WM_NCDESTROY)RemoveWindowSubclass(window,panelProc,1);
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
extern "C" void __cdecl Panel(HWND,int,wchar_t*,Stack** stack,void*) {
  panel=reinterpret_cast<HWND>(popHandle(stack));
  SetWindowLongPtrW(panel,GWL_STYLE,GetWindowLongPtrW(panel,GWL_STYLE)|WS_CLIPCHILDREN);
  SetWindowSubclass(panel,panelProc,1,0);
  InvalidateRect(panel,0,TRUE);
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
