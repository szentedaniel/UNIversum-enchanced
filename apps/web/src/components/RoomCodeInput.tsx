/**
 * The Room code input: one sticker box per digit (Base UI OTP Field). Typing
 * advances, Backspace goes back, and pasting or autofilling the whole code
 * into the first box fills them all. The first box carries the label.
 */
import { OTPField } from "@base-ui/react/otp-field";
import { useId } from "react";
import { cn } from "#lib/utils.ts";
import { m } from "#text.ts";

export const ROOM_CODE_LENGTH = 6;

export function RoomCodeInput({
  value,
  onValueChange,
  disabled,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <label htmlFor={id} className="sr-only">
        {m.home_code_label()}
      </label>
      <OTPField.Root
        id={id}
        length={ROOM_CODE_LENGTH}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        autoComplete="off"
        className="flex gap-1.5"
      >
        {Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => (
          <OTPField.Input
            key={index}
            aria-label={index === 0 ? undefined : m.home_code_digit({ index: index + 1 })}
            className="tnum h-12 w-10 rounded-xl border-[2.5px] border-input bg-white text-center text-2xl font-black text-ink outline-none focus:bg-primary/25 sm:w-11"
          />
        ))}
      </OTPField.Root>
    </div>
  );
}
