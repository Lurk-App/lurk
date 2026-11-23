// Keyboard for a radio group, as the platform expects it: the group is one Tab stop (the chosen
// option, or the first one when none is chosen), and the arrow keys move and choose.

import { useRef, type KeyboardEvent } from 'react';

export function useRadioGroup<T extends string>(options: readonly T[], value: T | null, choose: (option: T) => void) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const tabStop = value !== null && options.includes(value) ? value : options[0];

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = tabStop === undefined ? 0 : options.indexOf(tabStop);
    const next = options[(index + step + options.length) % options.length];
    if (next === undefined) return;
    choose(next);
    buttons.current.get(next)?.focus();
  }

  return {
    group: { role: 'radiogroup' as const, onKeyDown },
    option: (option: T) => ({
      role: 'radio' as const,
      'aria-checked': option === value,
      tabIndex: option === tabStop ? 0 : -1,
      ref: (element: HTMLButtonElement | null) => {
        if (element) buttons.current.set(option, element);
        else buttons.current.delete(option);
      },
      onClick: () => choose(option),
    }),
  };
}
