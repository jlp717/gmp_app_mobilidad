---
name: polish
description: UI polish — micro-interacciones, skeleton screens, estados vacíos/error, UI optimista y animaciones con timing correcto.
---

## Overview

Polish is the difference between software that works and software that feels good. It covers every state a UI can be in — loading, empty, error, success — plus the micro-interactions and animation timing that communicate state changes without overwhelming the user. A polished UI requires no thinking; the interface guides attention naturally.

---

## When to Use

- After the core feature is functional and tested — polish is the last pass, not the first
- During a dedicated "polish sprint" before a public launch
- When a usability test reveals that users feel uncertain or confused about UI state

## When NOT to Use

- Before the core functionality works correctly — never polish a broken feature
- When animation would distract from critical workflows (medical, financial alerts)

---

## Step-by-Step Process

### 1. Micro-Interactions

Every interactive element needs three states: default, hover, and active (pressed).

```css
/* Button micro-interaction */
.btn {
  transition: background-color 150ms ease, transform 100ms ease, box-shadow 150ms ease;
}
.btn:hover  { background-color: var(--brand-600); box-shadow: 0 4px 12px hsl(var(--brand-500) / 0.3); }
.btn:active { transform: scale(0.97); box-shadow: none; }
.btn:focus-visible {
  outline: 2px solid hsl(var(--brand-500));
  outline-offset: 2px;
}
```

Tailwind equivalent:
```tsx
<button className="transition-all duration-150 ease-out hover:bg-brand-600 hover:shadow-lg active:scale-95 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
```

**Key timing rules:**
- Hover: 100–150ms — fast, nearly instant
- Color/shadow transitions: 150ms ease
- Enter animations: 200–300ms ease-out
- Exit animations: 150–200ms ease-in (exit faster than enter)
- Never animate > 500ms for a UI response — it feels broken

### 2. Skeleton Screens

Use skeletons for content that loads asynchronously. They reduce perceived load time by setting expectations about the layout.

```tsx
// components/skeleton.tsx
function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-md bg-muted animate-pulse", className)}
      aria-hidden="true"
    />
  );
}

// Shimmer variant with CSS
function SkeletonShimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-md overflow-hidden relative bg-muted", className)}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
    </div>
  );
}
```

```css
/* globals.css */
@keyframes shimmer {
  100% { transform: translateX(100%); }
}
```

**Skeleton matches content shape:**
```tsx
function CardSkeleton() {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <Skeleton className="h-40 w-full" />          {/* image placeholder */}
      <Skeleton className="h-4 w-3/4" />            {/* title */}
      <Skeleton className="h-3 w-full" />            {/* description line 1 */}
      <Skeleton className="h-3 w-5/6" />            {/* description line 2 */}
      <div className="flex justify-between">
        <Skeleton className="h-8 w-20" />           {/* price */}
        <Skeleton className="h-8 w-24 rounded-full" /> {/* button */}
      </div>
    </div>
  );
}
```

Use skeletons for: content lists, cards, profile data. Use a spinner only for: form submission, file upload progress, page transitions.

### 3. Empty States

A blank page is broken. Every empty state needs: an illustration, a message explaining why it's empty, and an action CTA.

```tsx
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{description}</p>
      {action && (
        <Button onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}

// Usage
<EmptyState
  icon={InboxIcon}
  title="No messages yet"
  description="When you receive a message it will appear here."
  action={{ label: "Compose message", onClick: () => navigate("/compose") }}
/>
```

### 4. Error States

**Inline form errors** — next to the field, not at the top of the form:
```tsx
<p id="email-error" role="alert" className="mt-1 text-sm text-destructive flex items-center gap-1">
  <AlertCircleIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
  Enter a valid email address (e.g. name@example.com)
</p>
```

**Toast notifications** — non-blocking, top-right, auto-dismiss after 5s:
```tsx
import { toast } from "sonner";
toast.error("Failed to save changes. Your work has been preserved — try again.");
```

**Error page** — friendly language, always offer a retry:
```tsx
function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
      <p className="text-muted-foreground mb-6 max-w-sm">
        We hit an unexpected error. Your data is safe. Please try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
```

### 5. Optimistic UI

Update the UI immediately on user action; revert silently on failure with an error toast.

```tsx
// With React Query (TanStack Query)
const { mutate: toggleLike } = useMutation({
  mutationFn: (postId: string) => api.toggleLike(postId),
  onMutate: async (postId) => {
    await queryClient.cancelQueries({ queryKey: ["post", postId] });
    const previous = queryClient.getQueryData<Post>(["post", postId]);
    queryClient.setQueryData<Post>(["post", postId], (old) =>
      old ? { ...old, liked: !old.liked, likes: old.liked ? old.likes - 1 : old.likes + 1 } : old
    );
    return { previous };
  },
  onError: (_err, postId, context) => {
    queryClient.setQueryData(["post", postId], context?.previous);
    toast.error("Could not update like. Please try again.");
  },
  onSettled: (_data, _err, postId) => {
    queryClient.invalidateQueries({ queryKey: ["post", postId] });
  },
});
```

### 6. Edge Cases Checklist

| Edge case | Solution |
|-----------|----------|
| Very long text | `truncate` + `title` tooltip or `line-clamp-2` |
| Very long single word (URL) | `break-all` on text container |
| Zero / empty list | Empty state component |
| Network offline | `navigator.onLine` listener → offline banner |
| Permission denied | Friendly explanation + link to request access |
| Session expired | Redirect to login preserving return URL |
| Image fails to load | `onError` → fallback avatar/placeholder |
| Form submission in-flight | Disable submit button, show spinner in button |

```tsx
// Long text with tooltip
<p className="truncate max-w-xs" title={fullText}>
  {fullText}
</p>
```

---

## Verification Checklist

- [ ] All buttons have hover, active, and focus-visible states
- [ ] All transitions ≤ 150ms for hover, ≤ 300ms for enter, ≤ 200ms for exit
- [ ] Skeleton screens match the shape and layout of real content
- [ ] Every async list/page has an empty state (icon + message + CTA)
- [ ] Form errors are inline, use `role="alert"`, and describe how to fix
- [ ] Error pages offer a retry action and friendly language
- [ ] Optimistic mutations revert correctly on failure with error toast
- [ ] Long text does not break layouts (truncation + tooltip verified)
- [ ] Offline state is detected and communicated to the user
- [ ] No spinner used where a skeleton would be more appropriate
