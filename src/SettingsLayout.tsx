import { useLayoutEffect, useRef, type ReactNode } from "react";
import { UserCircle, GearSix, Images, HardDrives, Plug } from "@phosphor-icons/react";

const sections = [
  { id: "settings", label: "账号与偏好", icon: UserCircle },
  { id: "models", label: "模型与服务", icon: GearSix },
  { id: "skins", label: "皮肤中心", icon: Images },
  { id: "community-plugins", label: "开源社区插件", icon: Plug },
];
export const isSettingsPage = (page: string) =>
  sections.some((section) => section.id === page);

export default function SettingsLayout({
  page,
  navigate,
  exportRecords,
  children,
}: {
  page: string;
  navigate: (page: string) => void;
  exportRecords: () => void;
  children: ReactNode;
}) {
  const layout = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    layout.current?.scrollTo(0, 0);
  }, [page]);
  return (
    <div className="settings-page" ref={layout}>
      <nav className="settings-nav" aria-label="设置导航">
        <h2>设置</h2>
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={page === id ? "active" : ""}
            aria-current={page === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
        <button onClick={exportRecords}>
          <HardDrives size={18} />
          导出本地记录
        </button>
      </nav>
      <section className="settings-content">{children}</section>
    </div>
  );
}
