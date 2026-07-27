import { verifyMentee } from "@/lib/mentorship/dal";
import { Card, CardTitle } from "@/components/mentorship/ui";
import {
  ChangePasswordForm,
  ProfileEditor,
} from "@/components/mentorship/ProfileEditor";

export default async function ProfilePage() {
  const mentee = await verifyMentee();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Your profile
        </h1>
        <p className="mt-1 text-zinc-400">
          Keep this current. Your mentor uses it to shape your goals and open
          the right doors.
        </p>
      </div>

      <Card>
        <CardTitle kicker="Profile" title={mentee.name} />
        <ProfileEditor
          existing={{
            photoData: mentee.photoData,
            phone: mentee.phone,
            linkedin: mentee.linkedin,
            level: mentee.level,
            gradYear: mentee.gradYear,
            interests: mentee.interests,
            backgroundStory: mentee.backgroundStory,
            skills: mentee.skills,
            dreamRoles: mentee.dreamRoles,
            aspirations: mentee.aspirations,
            longTermVision: mentee.longTermVision,
            expectations: mentee.expectations,
            challenges: mentee.challenges,
            availability: mentee.availability,
            commsPref: mentee.commsPref,
          }}
        />
      </Card>

      <Card>
        <CardTitle kicker="Security" title="Change password" />
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
