ALTER TABLE "onboarding_provisioning" ADD COLUMN "authority_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "provision_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_provisioning" ADD CONSTRAINT "onboarding_provisioning_authority_instance_id_provider_instances_id_fk" FOREIGN KEY ("authority_instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_provision_instance_id_provider_instances_id_fk" FOREIGN KEY ("provision_instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION coast_managed_catalogue(subject_id uuid) RETURNS TABLE(connection_id uuid, instance_id uuid, access_after timestamptz) LANGUAGE sql STABLE AS $$
  SELECT c.id,c.instance_id,p.access_after FROM onboarding_provisioning p
  JOIN users u ON u.id=p.user_id AND NOT u.disabled AND coalesce(u.membership_expires_at>now(),true)
  LEFT JOIN provider_connections authority ON authority.id=p.connection_id AND authority.account_generation=p.account_generation AND authority.status='connected'
  JOIN provider_instances i ON i.id=coalesce(p.authority_instance_id,authority.instance_id) AND i.enabled AND i.provider='jellyfin'
  JOIN provider_connections c ON c.instance_id=i.id AND c.user_id=u.id AND c.status='connected'
    AND replace(lower(c.external_user_id),'-','')=replace(lower(p.remote_id),'-','')
  WHERE p.user_id=subject_id AND p.state='complete' AND p.lifecycle IN ('','active')
    AND coast_managed_schedule_open(p.active_defaults)
    AND EXISTS (SELECT 1 FROM sync_checkpoints s WHERE s.connection_id=c.id AND s.kind='jellyfin-seed'
      AND s.completed_at IS NOT NULL AND s.cursor=c.account_generation::text)
$$;
