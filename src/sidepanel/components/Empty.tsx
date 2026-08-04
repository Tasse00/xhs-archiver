import type { ReactNode } from 'react';

/**
 * 空态与错误态的统一形态：图标 + 一句结论 + 一句该怎么办。
 * 错误码收进灰底小框，标题说人话——码是给排查用的，不该当标题。
 */
export function Empty({
  icon, title, children, code, detail, alert, action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  code?: string;
  detail?: string;
  alert?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={alert ? 'empty is-alert' : 'empty'}>
      {icon}
      <h2>{title}</h2>
      <p>{children}</p>
      {code && (
        <div className="why">
          <b>{code}</b>
          {detail && <><br /><code>{detail}</code></>}
        </div>
      )}
      {action}
    </div>
  );
}
