import {
  Fragment,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Select } from "@base-ui/react/select";
import { Menu } from "@base-ui/react/menu";
import { ArrowUpRight, CaretDown, Check, Plug } from "@phosphor-icons/react";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  badge?: string;
  disabled?: boolean;
};

export function SelectField({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  variant = "field",
  side = "bottom",
  align = "start",
  placeholder = "请选择",
  disabled = false,
  icon,
  emptyText = "暂无可选项",
  emptyDescription,
  action,
}: {
  label: string;
  options: SelectOption[];
  value?: string | null;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  variant?: "field" | "quiet";
  side?: "top" | "bottom";
  align?: "start" | "end";
  placeholder?: string;
  disabled?: boolean;
  icon?: ReactNode;
  emptyText?: string;
  emptyDescription?: string;
  action?: { label: string; onClick: () => void };
}) {
  const [internalValue, setInternalValue] = useState<string | null>(
    defaultValue ?? options[0]?.value ?? null,
  );
  const [open, setOpen] = useState(false);
  const selected = value === undefined ? internalValue : value;
  const current = options.find((option) => option.value === selected);
  return (
    <Select.Root<string>
      items={options}
      value={selected}
      name={name}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
      modal={false}
      onValueChange={(next) => {
        if (next === null) return;
        setInternalValue(next);
        onValueChange?.(next);
      }}
    >
      <Select.Trigger
        aria-label={label}
        className={`select-trigger select-${variant}`}
        data-empty={!options.length || undefined}
        title={current?.label || placeholder}
      >
        {(icon || current?.icon) && (
          <span className="select-trigger-icon" aria-hidden="true">
            {icon || current?.icon}
          </span>
        )}
        <Select.Value className="select-value" placeholder={placeholder}>
          {() => current?.label ?? placeholder}
        </Select.Value>
        <Select.Icon className="select-caret">
          <CaretDown size={13} weight="bold" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="dropdown-positioner"
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          alignItemWithTrigger={false}
        >
          <Select.Popup
            className="select-popup"
            data-overlay-popup=""
            aria-label={label}
          >
            <div className="select-heading">
              {label}
              <span>
                {options.length ? `${options.length} 项` : "尚未配置"}
              </span>
            </div>
            {options.length ? (
              <Select.List className="select-list">
                {options.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    label={option.label}
                    disabled={option.disabled}
                    className="select-option"
                  >
                    {option.icon && (
                      <span className="select-option-icon" aria-hidden="true">
                        {option.icon}
                      </span>
                    )}
                    <span className="select-option-copy">
                      <Select.ItemText className="select-option-label">
                        {option.label}
                      </Select.ItemText>
                      {option.description && (
                        <span className="select-description">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {option.badge && (
                      <span className="select-badge">{option.badge}</span>
                    )}
                    <span className="select-check">
                      <Select.ItemIndicator>
                        <Check size={15} weight="bold" />
                      </Select.ItemIndicator>
                    </span>
                  </Select.Item>
                ))}
              </Select.List>
            ) : (
              <div className="select-empty">
                <span className="select-empty-icon">
                  <Plug size={23} />
                </span>
                <strong>{emptyText}</strong>
                {emptyDescription && <p>{emptyDescription}</p>}
              </div>
            )}
            {action && (
              <div className="select-footer">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    action.onClick();
                  }}
                >
                  {action.label}
                  <ArrowUpRight size={15} />
                </button>
              </div>
            )}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export type ActionMenuItem = {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  separatorBefore?: boolean;
};

export function ActionMenu({
  trigger,
  items,
  header,
  side = "bottom",
  open,
  onOpenChange,
  className = "",
  restoreFocusBeforeAction = false,
}: {
  trigger: ReactElement;
  items: ActionMenuItem[];
  header?: ReactNode;
  side?: "top" | "bottom";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  restoreFocusBeforeAction?: boolean;
}) {
  const before = useRef<HTMLElement | null>(null);
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Menu.Trigger
        render={trigger}
        onPointerDownCapture={() => {
          before.current = document.activeElement as HTMLElement;
        }}
      />
      <Menu.Portal>
        <Menu.Positioner
          className="dropdown-positioner"
          side={side}
          align="start"
          sideOffset={8}
          collisionPadding={12}
        >
          <Menu.Popup
            className={`action-menu-popup ${className}`}
            data-overlay-popup=""
            finalFocus={
              restoreFocusBeforeAction
                ? () => before.current ?? true
                : undefined
            }
          >
            {header}
            {items.map((item) => (
              <Fragment key={item.label}>
                {item.separatorBefore && (
                  <Menu.Separator className="menu-separator" />
                )}
                <Menu.Item
                  className="action-menu-item"
                  data-danger={item.danger || undefined}
                  onClick={() => {
                    if (restoreFocusBeforeAction)
                      before.current?.focus({ preventScroll: true });
                    item.onSelect();
                  }}
                >
                  {item.icon && (
                    <span className="action-menu-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                  )}
                  <span>{item.label}</span>
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </Menu.Item>
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
