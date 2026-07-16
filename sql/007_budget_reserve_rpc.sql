-- Atomic budget reservation.
--
-- Why: the June 2026 overshoot (1,730/1,000 Enterprise calls ≈ 18€) happened
-- because budget checks were read-modify-write in application code: concurrent
-- runs (hoi-an + da-nang share the 'google-maps' budget row) read the same
-- stale counter, both passed the check, both wrote. The counter was also only
-- incremented AFTER the API call, with the return value ignored.
--
-- Fix: reserve the call slot atomically BEFORE the API call. The conditional
-- UPDATE either claims the slot (row updated, returns true) or leaves the
-- counter untouched (returns false) — no window for a second process.

create or replace function reserve_api_budget(
  p_tool_slug text,
  p_sku text,
  p_month text,
  p_count integer default 1
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update api_budget_usage
     set calls_used = calls_used + p_count,
         estimated_cost = greatest(0, calls_used + p_count - calls_limit) * cost_per_call,
         updated_at = now()
   where tool_slug = p_tool_slug
     and sku = p_sku
     and month = p_month
     and calls_used + p_count <= calls_safety;
  return found;
end;
$$;

-- Give a reserved slot back when the API call itself failed.
create or replace function release_api_budget(
  p_tool_slug text,
  p_sku text,
  p_month text,
  p_count integer default 1
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update api_budget_usage
     set calls_used = greatest(0, calls_used - p_count),
         estimated_cost = greatest(0, greatest(0, calls_used - p_count) - calls_limit) * cost_per_call,
         updated_at = now()
   where tool_slug = p_tool_slug
     and sku = p_sku
     and month = p_month;
end;
$$;

-- Service-role only (tools backend); never callable from the browser.
revoke execute on function reserve_api_budget(text, text, text, integer) from public, anon, authenticated;
revoke execute on function release_api_budget(text, text, text, integer) from public, anon, authenticated;
