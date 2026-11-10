import { Menu } from "@base-ui/react/menu";
import {
  ArrowUpRight,
  CaretDown,
  CaretRight,
  Check,
  Plug,
} from "@phosphor-icons/react";
import type { Connection } from "../shared/types";
import { modelGroups } from "../shared/model-groups";
import "./model-picker.css";

export default function ModelPicker({
  connections,
  value,
  change,
  manage,
}: {
  connections: Connection[];
  value: string | null;
  change: (id: string) => void;
  manage: () => void;
}) {
  const groups = modelGroups(connections);
  const current = connections.find((c) => c.id === value);
  const provider = groups.find((group) =>
    group.models.some((c) => c.id === value),
  );
  const item = (connection: Connection, providerLabel?: string) => (
    <Menu.RadioItem
      key={connection.id}
      value={connection.id}
      label={connection.name}
      closeOnClick
      className="select-option model-picker-option"
      data-model-name={connection.name}
      data-connection-id={connection.id}
      data-selected={connection.id === value || undefined}
    >
      <span className="select-option-icon">
        <Plug size={18} />
      </span>
      <span className="select-option-copy">
        <span className="select-option-label">
          {providerLabel ? connection.model : connection.name}
        </span>
        <span className="select-description">
          {providerLabel
            ? `${connection.personal ? "个人配置" : "公司授权"} · ${connection.serviceName ?? providerLabel}`
            : connection.model}
        </span>
      </span>
      <span className="select-check">
        <Menu.RadioItemIndicator>
          <Check size={15} weight="bold" />
        </Menu.RadioItemIndicator>
      </span>
    </Menu.RadioItem>
  );
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label="选择模型"
        className="select-trigger select-quiet model-picker-trigger"
        title={current?.name ?? "未配置模型"}
        data-empty={!groups.length || undefined}
      >
        {current && provider ? (
          <small className="model-provider-badge">{provider.label}</small>
        ) : (
          <span className="select-trigger-icon">
            <Plug size={18} />
          </span>
        )}
        <span className="select-value">
          {current
            ? current.serviceId
              ? current.model
              : current.name
            : "未配置模型"}
        </span>
        <span className="select-caret">
          <CaretDown size={13} weight="bold" />
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="dropdown-positioner"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <Menu.Popup
            className="select-popup model-picker-popup"
            data-overlay-popup=""
            aria-label="选择模型"
          >
            <div className="select-heading">
              选择模型
              <span>
                {connections.length
                  ? `${connections.length} 个模型`
                  : "尚未配置"}
              </span>
            </div>
            {groups.length ? (
              <Menu.RadioGroup
                value={value}
                onValueChange={change}
                className="select-list"
              >
                {groups.map((group) =>
                  group.submenu ? (
                    <Menu.SubmenuRoot key={group.id}>
                      <Menu.SubmenuTrigger
                        className="select-option model-provider-option"
                        label={group.label}
                        openOnHover
                        delay={100}
                        closeDelay={180}
                        data-provider-id={group.id}
                        data-model-labels={JSON.stringify(
                          group.models.map((c) => c.name),
                        )}
                      >
                        <span className="select-option-icon">
                          <Plug size={18} />
                        </span>
                        <span className="select-option-copy">
                          <span className="select-option-label">
                            {group.label}
                          </span>
                          <span className="select-description">
                            {group.models.length} 个模型
                            {group.models.some((c) => c.id === value)
                              ? " · 当前使用"
                              : ""}
                          </span>
                        </span>
                        <CaretRight size={15} />
                      </Menu.SubmenuTrigger>
                      <Menu.Portal>
                        <Menu.Positioner
                          className="dropdown-positioner"
                          side="right"
                          align="start"
                          sideOffset={6}
                          collisionPadding={12}
                        >
                          <Menu.Popup
                            className="select-popup model-picker-submenu"
                            data-overlay-popup=""
                            aria-label={`${group.label} 模型`}
                          >
                            <div className="select-heading">
                              {group.label}
                              <span>{group.models.length} 个模型</span>
                            </div>
                            <Menu.RadioGroup
                              value={value}
                              onValueChange={change}
                              className="select-list"
                            >
                              {group.models.map((c) => item(c, group.label))}
                            </Menu.RadioGroup>
                          </Menu.Popup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </Menu.SubmenuRoot>
                  ) : (
                    group.models.map((c) => item(c))
                  ),
                )}
              </Menu.RadioGroup>
            ) : (
              <div className="select-empty">
                <span className="select-empty-icon">
                  <Plug size={23} />
                </span>
                <strong>尚未配置可用模型</strong>
                <p>添加服务连接后，即可在这里切换获准使用的模型。</p>
              </div>
            )}
            <Menu.Separator className="menu-separator" />
            <Menu.Item
              className="action-menu-item model-picker-manage"
              onClick={manage}
            >
              前往模型与服务
              <ArrowUpRight size={15} />
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
