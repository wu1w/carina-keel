
#pragma once
#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Tickable.h"
#include "CarinaWorldRuntimeSubsystem.generated.h"

UCLASS()
class CARINAPS_API UCarinaWorldRuntimeSubsystem : public UGameInstanceSubsystem, public FTickableGameObject
{
	GENERATED_BODY()
public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;
	virtual bool IsTickable() const override { return !IsTemplate(); }
	virtual bool IsTickableInEditor() const override { return false; }

private:
	void EnsureDirs();
	void WriteHeartbeat();
	void PollInbox();
	void HandleCommand(const TSharedPtr<FJsonObject>& Cmd, const FString& IpcId);
	void Reply(const FString& IpcId, const TSharedPtr<FJsonObject>& Body);

	bool SpawnObject(const TSharedPtr<FJsonObject>& Cmd, FString& OutActorId, FString& OutError, double& OutMs);
	bool MoveObject(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs);
	bool DestroyObject(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs);
	bool ActivateAsset(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs);
	bool PlayerPose(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs);
	bool HighResShot(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs);
	bool InteractObject(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs);
	bool DumpSpawned(const TSharedPtr<FJsonObject>& Cmd, const TSharedRef<FJsonObject>& Resp, FString& OutError, double& OutMs);
	bool IsolateCarina(const TSharedPtr<FJsonObject>& Cmd, const TSharedRef<FJsonObject>& Resp, FString& OutError, double& OutMs);

	FString InboxDir;
	FString OutboxDir;
	float HeartbeatAccum = 0.f;
	TMap<FString, TWeakObjectPtr<AActor>> Spawned;
};
