-- Run this in Supabase SQL Editor to add deal action types
-- to the existing growth_lead_actions constraint.

ALTER TABLE growth_lead_actions
  DROP CONSTRAINT IF EXISTS growth_lead_actions_action_type_check;

ALTER TABLE growth_lead_actions
  ADD CONSTRAINT growth_lead_actions_action_type_check
  CHECK (action_type IN (
    'email','social_outreach','call','reject','return','reply','promote',
    'deal_stage_advance','deal_lost','deal_won'
  ));
