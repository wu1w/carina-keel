
#include "CarinaWorldRuntimeSubsystem.h"
#include "Engine/World.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
#include "Components/BoxComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/PrimitiveComponent.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/PlatformFileManager.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Dom/JsonObject.h"
#include "UObject/SoftObjectPath.h"
#include "UObject/ConstructorHelpers.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/DefaultPawn.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "Camera/CameraActor.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "PhysicsEngine/BodySetup.h"
#include "CollisionQueryParams.h"

static FVector ReadVec(const TSharedPtr<FJsonObject>& Obj, const FString& Field);

static bool IsScaffoldObjectId(const FString& ObjectId)
{
	if (ObjectId.Contains(TEXT("space-shell")))
	{
		return false;
	}
	return ObjectId.Contains(TEXT("garden-floor")) ||
		ObjectId.Contains(TEXT("garden-wall")) ||
		ObjectId == TEXT("floor") ||
		ObjectId.EndsWith(TEXT("-floor")) ||
		ObjectId.StartsWith(TEXT("wall-")) ||
		ObjectId.Contains(TEXT("-wall-"));
}

void UCarinaWorldRuntimeSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	EnsureDirs();
	WriteHeartbeat();
	UE_LOG(LogTemp, Log, TEXT("CarinaWorldRuntime: IPC ready inbox=%s"), *InboxDir);
}

void UCarinaWorldRuntimeSubsystem::Deinitialize()
{
	Super::Deinitialize();
}

TStatId UCarinaWorldRuntimeSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UCarinaWorldRuntimeSubsystem, STATGROUP_Tickables);
}

void UCarinaWorldRuntimeSubsystem::EnsureDirs()
{
	const FString Saved = FPaths::ProjectSavedDir() / TEXT("CarinaWorldRuntime");
	InboxDir = Saved / TEXT("inbox");
	OutboxDir = Saved / TEXT("outbox");
	IPlatformFile& PF = FPlatformFileManager::Get().GetPlatformFile();
	PF.CreateDirectoryTree(*InboxDir);
	PF.CreateDirectoryTree(*OutboxDir);
}

void UCarinaWorldRuntimeSubsystem::WriteHeartbeat()
{
	EnsureDirs();
	TSharedRef<FJsonObject> Hb = MakeShared<FJsonObject>();
	Hb->SetBoolField(TEXT("ok"), true);
	Hb->SetStringField(TEXT("service"), TEXT("CarinaWorldRuntime"));
	Hb->SetNumberField(TEXT("unixTime"), FDateTime::UtcNow().ToUnixTimestamp());
	FString Out;
	TSharedRef<TJsonWriter<>> W = TJsonWriterFactory<>::Create(&Out);
	FJsonSerializer::Serialize(Hb, W);
	FFileHelper::SaveStringToFile(Out, *(OutboxDir / TEXT("_heartbeat.json")));
}

void UCarinaWorldRuntimeSubsystem::Tick(float DeltaTime)
{
	HeartbeatAccum += DeltaTime;
	if (HeartbeatAccum >= 2.f)
	{
		HeartbeatAccum = 0.f;
		WriteHeartbeat();
	}
	PollInbox();
}

void UCarinaWorldRuntimeSubsystem::PollInbox()
{
	IPlatformFile& PF = FPlatformFileManager::Get().GetPlatformFile();
	TArray<FString> Files;
	PF.FindFiles(Files, *InboxDir, TEXT("json"));
	// FindFiles may return bare names; normalize to absolute paths
	for (FString& F : Files)
	{
		if (!F.Contains(TEXT("/")) && !F.Contains(TEXT("\\")))
		{
			F = InboxDir / F;
		}
	}
	for (const FString& FilePath : Files)
	{
		FString Content;
		if (!FFileHelper::LoadFileToString(Content, *FilePath))
		{
			continue;
		}
		TSharedPtr<FJsonObject> Root;
		TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Content);
		if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
		{
			PF.DeleteFile(*FilePath);
			continue;
		}
		FString IpcId = Root->GetStringField(TEXT("ipcId"));
		if (IpcId.IsEmpty())
		{
			IpcId = FPaths::GetBaseFilename(FilePath);
		}
		HandleCommand(Root, IpcId);
		PF.DeleteFile(*FilePath);
	}
}

void UCarinaWorldRuntimeSubsystem::Reply(const FString& IpcId, const TSharedPtr<FJsonObject>& Body)
{
	EnsureDirs();
	FString Out;
	TSharedRef<TJsonWriter<>> W = TJsonWriterFactory<>::Create(&Out);
	FJsonSerializer::Serialize(Body.ToSharedRef(), W);
	FFileHelper::SaveStringToFile(Out, *(OutboxDir / (IpcId + TEXT(".json"))));
}

void UCarinaWorldRuntimeSubsystem::HandleCommand(const TSharedPtr<FJsonObject>& Cmd, const FString& IpcId)
{
	const FString Op = Cmd->GetStringField(TEXT("op"));
	TSharedRef<FJsonObject> Resp = MakeShared<FJsonObject>();
	Resp->SetStringField(TEXT("ipcId"), IpcId);
	Resp->SetStringField(TEXT("op"), Op);
	FString Err;
	double Ms = 0.0;
	bool Ok = false;
	if (Op == TEXT("spawn"))
	{
		FString ActorId;
		Ok = SpawnObject(Cmd, ActorId, Err, Ms);
		if (Ok)
		{
			Resp->SetStringField(TEXT("ueActorId"), ActorId);
			Resp->SetStringField(TEXT("softObjectPath"), Cmd->GetStringField(TEXT("softObjectPath")));
			const FString SpawnedId = Cmd->GetStringField(TEXT("objectId"));
			bool bCollision = true;
			if (Cmd->HasField(TEXT("collision")))
			{
				bCollision = Cmd->GetBoolField(TEXT("collision"));
			}
			if (SpawnedId.Contains(TEXT("space-shell")))
			{
				bCollision = false;
			}
			Resp->SetBoolField(TEXT("collision"), bCollision);
		}
	}
	else if (Op == TEXT("move"))
	{
		Ok = MoveObject(Cmd, Err, Ms);
	}
	else if (Op == TEXT("destroy"))
	{
		Ok = DestroyObject(Cmd, Err, Ms);
	}
	else if (Op == TEXT("activate"))
	{
		Ok = ActivateAsset(Cmd, Err, Ms);
	}
	else if (Op == TEXT("ping"))
	{
		Ok = true;
	}
	else if (Op == TEXT("player_pose"))
	{
		if (UWorld* PoseWorld = GetWorld())
		{
			if (Cmd->HasField(TEXT("ueLocationCm")))
			{
				const FVector Start = ReadVec(Cmd, TEXT("ueLocationCm"));
				FHitResult Hit;
				FCollisionQueryParams Query(TEXT("CarinaGround"), true);
				const bool bHit = PoseWorld->LineTraceSingleByChannel(
					Hit, Start, Start - FVector(0.f, 0.f, 8000.f), ECC_WorldStatic, Query);
				Resp->SetBoolField(TEXT("groundHit"), bHit);
				if (bHit)
				{
					Resp->SetNumberField(TEXT("groundX"), Hit.ImpactPoint.X);
					Resp->SetNumberField(TEXT("groundY"), Hit.ImpactPoint.Y);
					Resp->SetNumberField(TEXT("groundZ"), Hit.ImpactPoint.Z);
					if (AActor* HitActor = Hit.GetActor())
					{
						Resp->SetStringField(TEXT("groundActor"), HitActor->GetName());
					}
				}
			}
			else
			{
				Resp->SetBoolField(TEXT("groundHit"), false);
				Resp->SetBoolField(TEXT("rotateOnly"), true);
			}
		}
		Ok = PlayerPose(Cmd, Err, Ms);
		if (UWorld* PoseWorld = GetWorld())
		{
			if (APlayerController* PosePC = PoseWorld->GetFirstPlayerController())
			{
				if (APawn* PosePawn = PosePC->GetPawn())
				{
					const FVector After = PosePawn->GetActorLocation();
					Resp->SetNumberField(TEXT("pawnX"), After.X);
					Resp->SetNumberField(TEXT("pawnY"), After.Y);
					Resp->SetNumberField(TEXT("pawnZ"), After.Z);
					Resp->SetStringField(TEXT("pawnName"), PosePawn->GetName());
				}
			}
		}
		if (StillCamera.IsValid())
		{
			const FVector CamLoc = StillCamera->GetActorLocation();
			const FRotator CamRot = StillCamera->GetActorRotation();
			Resp->SetBoolField(TEXT("usingStillCamera"), true);
			Resp->SetNumberField(TEXT("stillCamX"), CamLoc.X);
			Resp->SetNumberField(TEXT("stillCamY"), CamLoc.Y);
			Resp->SetNumberField(TEXT("stillCamZ"), CamLoc.Z);
			Resp->SetNumberField(TEXT("stillCamPitch"), CamRot.Pitch);
			Resp->SetNumberField(TEXT("stillCamYaw"), CamRot.Yaw);
			Resp->SetNumberField(TEXT("stillCamRoll"), CamRot.Roll);
		}
		else
		{
			Resp->SetBoolField(TEXT("usingStillCamera"), false);
		}
	}
	else if (Op == TEXT("highresshot"))
	{
		Ok = HighResShot(Cmd, Err, Ms);
	}
	else if (Op == TEXT("interact"))
	{
		Ok = InteractObject(Cmd, Err, Ms);
	}
	else if (Op == TEXT("dump_spawned"))
	{
		Ok = DumpSpawned(Cmd, Resp, Err, Ms);
	}
	else if (Op == TEXT("isolate_carina"))
	{
		Ok = IsolateCarina(Cmd, Resp, Err, Ms);
	}
	else
	{
		Err = FString::Printf(TEXT("unknown op %s"), *Op);
	}
	Resp->SetBoolField(TEXT("ok"), Ok);
	Resp->SetNumberField(TEXT("ms"), Ms);
	if (!Ok) { Resp->SetStringField(TEXT("error"), Err); }
	Reply(IpcId, Resp);
}

static FVector ReadVec(const TSharedPtr<FJsonObject>& Obj, const FString& Field)
{
	const TSharedPtr<FJsonObject>* Sub = nullptr;
	if (!Obj->TryGetObjectField(Field, Sub) || !Sub || !Sub->IsValid())
	{
		return FVector::ZeroVector;
	}
	return FVector(
		(*Sub)->GetNumberField(TEXT("x")),
		(*Sub)->GetNumberField(TEXT("y")),
		(*Sub)->GetNumberField(TEXT("z")));
}

static FRotator ReadRotatorDeg(const TSharedPtr<FJsonObject>& Obj)
{
	const TSharedPtr<FJsonObject>* Sub = nullptr;
	if (!Obj->TryGetObjectField(TEXT("ueRotatorDeg"), Sub) || !Sub || !Sub->IsValid())
	{
		return FRotator::ZeroRotator;
	}
	return FRotator(
		(*Sub)->GetNumberField(TEXT("pitch")),
		(*Sub)->GetNumberField(TEXT("yaw")),
		(*Sub)->GetNumberField(TEXT("roll")));
}

bool UCarinaWorldRuntimeSubsystem::ActivateAsset(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs)
{
	const double T0 = FPlatformTime::Seconds();
	const FString SoftPath = Cmd->GetStringField(TEXT("softObjectPath"));
	FSoftObjectPath Path(SoftPath);
	UObject* Obj = Path.TryLoad();
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	if (!Obj)
	{
		OutError = FString::Printf(TEXT("SoftObjectPath failed to load: %s"), *SoftPath);
		return false;
	}
	UE_LOG(LogTemp, Log, TEXT("CarinaWorldRuntime activate ok %s -> %s"), *SoftPath, *Obj->GetName());
	return true;
}

bool UCarinaWorldRuntimeSubsystem::SpawnObject(const TSharedPtr<FJsonObject>& Cmd, FString& OutActorId, FString& OutError, double& OutMs)
{
	const double T0 = FPlatformTime::Seconds();
	UWorld* World = GetWorld();
	if (!World)
	{
		UGameInstance* GI = GetGameInstance();
		World = GI ? GI->GetWorld() : nullptr;
	}
	if (!World)
	{
		OutError = TEXT("no UWorld");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	const FString ObjectId = Cmd->GetStringField(TEXT("objectId"));
	const FString SoftPath = Cmd->GetStringField(TEXT("softObjectPath"));
	FSoftObjectPath Path(SoftPath);
	UStaticMesh* Mesh = Cast<UStaticMesh>(Path.TryLoad());
	if (!Mesh)
	{
		// try appending _C or .AssetName
		OutError = FString::Printf(TEXT("failed to load StaticMesh at SoftObjectPath %s"), *SoftPath);
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	if (Spawned.Contains(ObjectId))
	{
		if (AActor* Existing = Spawned[ObjectId].Get())
		{
			Existing->Destroy();
		}
		Spawned.Remove(ObjectId);
	}
	World->FlushLevelStreaming(EFlushLevelStreamingType::Full);
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.NameMode = FActorSpawnParameters::ESpawnActorNameMode::Requested;
	// Do not force ObjectId as UObject name — reuse after Destroy can crash until GC.
	const FVector Loc = ReadVec(Cmd, TEXT("ueLocationCm"));
	const FRotator Rot = ReadRotatorDeg(Cmd);
	const FVector Scale = ReadVec(Cmd, TEXT("ueScale"));
	AStaticMeshActor* Actor = World->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), Loc, Rot, Params);
	if (!Actor)
	{
		OutError = TEXT("SpawnActor failed");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	Actor->SetActorScale3D(Scale.IsNearlyZero() ? FVector::OneVector : Scale);
	UStaticMeshComponent* Comp = Actor->GetStaticMeshComponent();
	if (Comp)
	{
		Comp->SetMobility(EComponentMobility::Movable);
		Comp->SetStaticMesh(Mesh);
		if (UBodySetup* Body = Mesh->GetBodySetup())
		{
			Body->CollisionTraceFlag = CTF_UseComplexAsSimple;
			if (Body->AggGeom.GetElementCount() == 0)
			{
				Body->InvalidatePhysicsData();
				Body->CreatePhysicsMeshes();
			}
		}
		Comp->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		Comp->SetCollisionObjectType(ECC_WorldStatic);
		Comp->SetCollisionResponseToAllChannels(ECR_Block);
		Comp->SetCollisionResponseToChannel(ECC_Camera, ECR_Ignore);
		Comp->SetCollisionProfileName(TEXT("BlockAll"));
		Comp->SetSimulatePhysics(false);
		Comp->SetGenerateOverlapEvents(true);
		Comp->RecreatePhysicsState();
		Comp->UpdateBounds();
		Comp->MarkRenderStateDirty();
		bool bCollision = true;
		if (Cmd->HasField(TEXT("collision")))
		{
			bCollision = Cmd->GetBoolField(TEXT("collision"));
		}
		// Space shell is a visual overlay. Collision stays on SceneSpec scaffold boxes.
		if (ObjectId.Contains(TEXT("space-shell")))
		{
			bCollision = false;
		}
		if (!bCollision)
		{
			Comp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Actor->SetActorEnableCollision(false);
		}
		const bool bScaffoldBox = IsScaffoldObjectId(ObjectId);
		if (bScaffoldBox)
		{
			Actor->SetActorHiddenInGame(true);
			const FBox WorldBox = Mesh->GetBoundingBox().TransformBy(Actor->GetActorTransform());
			const FVector Extent = WorldBox.GetExtent();
			FActorSpawnParameters BoxParams;
			BoxParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			AActor* Volume = World->SpawnActor<AActor>(AActor::StaticClass(), WorldBox.GetCenter(), FRotator::ZeroRotator, BoxParams);
			if (Volume)
			{
				UBoxComponent* Box = NewObject<UBoxComponent>(Volume, TEXT("CarinaScaffoldBox"));
				Box->SetMobility(EComponentMobility::Static);
				Volume->SetRootComponent(Box);
				Box->SetBoxExtent(Extent);
				Box->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
				Box->SetCollisionObjectType(ECC_WorldStatic);
				Box->SetCollisionProfileName(TEXT("BlockAll"));
				Box->SetGenerateOverlapEvents(false);
				Box->SetCanEverAffectNavigation(false);
				Box->RegisterComponent();
				Volume->AddInstanceComponent(Box);
				Volume->SetActorEnableCollision(true);
				Volume->Tags.Add(FName(TEXT("CarinaDynamic")));
			}
		}
	}
	Actor->Tags.Add(FName(TEXT("CarinaDynamic")));
	Actor->UpdateComponentTransforms();
	Spawned.Add(ObjectId, Actor);
	OutActorId = Actor->GetName();
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	const float Radius = (Comp && Comp->GetStaticMesh()) ? Comp->GetStaticMesh()->GetBounds().SphereRadius : -1.f;
	UE_LOG(LogTemp, Log, TEXT("CarinaWorldRuntime spawn %s mesh=%s actor=%s applied=%d radius=%.1f ms=%.2f"),
		*ObjectId, *Mesh->GetName(), *OutActorId, (Comp && Comp->GetStaticMesh()) ? 1 : 0, Radius, OutMs);
	return true;
}

bool UCarinaWorldRuntimeSubsystem::MoveObject(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs)
{
	const double T0 = FPlatformTime::Seconds();
	const FString ObjectId = Cmd->GetStringField(TEXT("objectId"));
	TWeakObjectPtr<AActor>* Found = Spawned.Find(ObjectId);
	if (!Found || !Found->IsValid())
	{
		OutError = TEXT("objectId not spawned");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	AActor* Actor = Found->Get();
	Actor->SetActorLocation(ReadVec(Cmd, TEXT("ueLocationCm")));
	Actor->SetActorRotation(ReadRotatorDeg(Cmd));
	const FVector Scale = ReadVec(Cmd, TEXT("ueScale"));
	if (!Scale.IsNearlyZero())
	{
		Actor->SetActorScale3D(Scale);
	}
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	return true;
}

bool UCarinaWorldRuntimeSubsystem::DestroyObject(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs)
{
	const double T0 = FPlatformTime::Seconds();
	const FString ObjectId = Cmd->GetStringField(TEXT("objectId"));
	TWeakObjectPtr<AActor>* Found = Spawned.Find(ObjectId);
	if (!Found || !Found->IsValid())
	{
		OutError = TEXT("objectId not spawned");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	Found->Get()->Destroy();
	Spawned.Remove(ObjectId);
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	return true;
}


bool UCarinaWorldRuntimeSubsystem::PlayerPose(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs)
{
	const double T0 = FPlatformTime::Seconds();
	UWorld* World = GetWorld();
	if (!World)
	{
		UGameInstance* GI = GetGameInstance();
		World = GI ? GI->GetWorld() : nullptr;
	}
	if (!World)
	{
		OutError = TEXT("no UWorld");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	APlayerController* PC = World->GetFirstPlayerController();
	if (!PC)
	{
		OutError = TEXT("no PlayerController");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	const bool bHasLoc = Cmd->HasField(TEXT("ueLocationCm"));
	const FVector Loc = bHasLoc ? ReadVec(Cmd, TEXT("ueLocationCm")) : FVector::ZeroVector;
	const FRotator Rot = ReadRotatorDeg(Cmd);
	APawn* Pawn = PC->GetPawn();
	if (!Pawn)
	{
		Pawn = PC->AcknowledgedPawn;
	}
	if (!Pawn)
	{
		for (TActorIterator<APawn> It(World); It; ++It)
		{
			Pawn = *It;
			break;
		}
	}
	if (!Pawn)
	{
		if (!bHasLoc)
		{
			OutError = TEXT("no pawn to rotate");
			OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
			return false;
		}
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Pawn = World->SpawnActor<ADefaultPawn>(ADefaultPawn::StaticClass(), Loc, Rot, Params);
		if (Pawn)
		{
			Pawn->Tags.Add(FName(TEXT("CarinaDynamic")));
			PC->Possess(Pawn);
		}
	}
	if (Pawn)
	{
		if (bHasLoc)
		{
			Pawn->DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);
			if (ACharacter* Character = Cast<ACharacter>(Pawn))
			{
				Character->SetBase(static_cast<UPrimitiveComponent*>(nullptr));
				if (UCharacterMovementComponent* Move = Character->GetCharacterMovement())
				{
					Move->StopMovementImmediately();
					Move->Velocity = FVector::ZeroVector;
					Move->ClearAccumulatedForces();
					Move->SetMovementMode(MOVE_None);
				}
			}
			Pawn->SetReplicateMovement(false);
			const bool bMoved = Pawn->TeleportTo(Loc, Rot, false, true);
			if (!bMoved)
			{
				Pawn->SetActorLocationAndRotation(Loc, Rot, false, nullptr, ETeleportType::ResetPhysics);
			}
			if (ACharacter* Character = Cast<ACharacter>(Pawn))
			{
				Character->SetBase(static_cast<UPrimitiveComponent*>(nullptr));
				if (UCharacterMovementComponent* Move = Character->GetCharacterMovement())
				{
					Move->StopMovementImmediately();
					Move->Velocity = FVector::ZeroVector;
					Move->bJustTeleported = true;
					if (Cmd->HasField(TEXT("hidePawn")) && !Cmd->GetBoolField(TEXT("hidePawn")))
					{
						Pawn->SetActorEnableCollision(true);
						Move->bCheatFlying = false;
						Move->GravityScale = 1.f;
						// Walking would navmesh-project back to the default map start.
						Move->SetMovementMode(MOVE_Falling);
					}
				}
			}
		}
		else
		{
			Pawn->SetActorRotation(Rot);
		}
		if (Cmd->HasField(TEXT("springArmLength")))
		{
			const float ArmLen = static_cast<float>(Cmd->GetNumberField(TEXT("springArmLength")));
			TArray<USpringArmComponent*> Arms;
			Pawn->GetComponents<USpringArmComponent>(Arms);
			for (USpringArmComponent* Arm : Arms)
			{
				if (Arm)
				{
					Arm->TargetArmLength = ArmLen;
				}
			}
		}
		if (Cmd->HasField(TEXT("hidePawn")))
		{
			Pawn->SetActorHiddenInGame(Cmd->GetBoolField(TEXT("hidePawn")));
		}
		if (Cmd->HasField(TEXT("spawnStandPawn")) && Cmd->GetBoolField(TEXT("spawnStandPawn")))
		{
			if (StandProbe.IsValid())
			{
				StandProbe->Destroy();
				StandProbe.Reset();
			}
			FActorSpawnParameters StandParams;
			StandParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			AActor* Probe = World->SpawnActor<AActor>(AActor::StaticClass(), Loc, Rot, StandParams);
			if (Probe)
			{
				UBoxComponent* Box = NewObject<UBoxComponent>(Probe, TEXT("CarinaStandProbe"));
				Probe->SetRootComponent(Box);
				Box->SetBoxExtent(FVector(20.f, 20.f, 40.f));
				Box->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
				Box->SetCollisionObjectType(ECC_PhysicsBody);
				Box->SetCollisionResponseToAllChannels(ECR_Block);
				Box->SetEnableGravity(true);
				Box->SetSimulatePhysics(true);
				Box->SetMassOverrideInKg(NAME_None, 70.f, true);
				Box->RegisterComponent();
				Probe->SetActorEnableCollision(true);
				Probe->SetActorLocation(Loc);
				Probe->Tags.Add(FName(TEXT("CarinaDynamic")));
				StandProbe = Probe;
			}
		}
	}
	else
	{
		PC->SetInitialLocationAndRotation(Loc, Rot);
	}
	if (Pawn && PC->GetPawn() != Pawn)
	{
		PC->Possess(Pawn);
	}
	PC->SetControlRotation(Rot);
	const bool bHidePawn = Cmd->HasField(TEXT("hidePawn")) && Cmd->GetBoolField(TEXT("hidePawn"));
	if (bHidePawn)
	{
		if (!StillCamera.IsValid())
		{
			FActorSpawnParameters CamParams;
			CamParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			StillCamera = World->SpawnActor<ACameraActor>(ACameraActor::StaticClass(), Loc, Rot, CamParams);
			if (StillCamera.IsValid())
			{
				StillCamera->Tags.Add(FName(TEXT("CarinaDynamic")));
			}
		}
		if (StillCamera.IsValid())
		{
			StillCamera->SetActorLocationAndRotation(Loc, Rot);
			PC->SetViewTargetWithBlend(StillCamera.Get(), 0.f);
		}
	}
	else if (Pawn)
	{
		PC->SetViewTargetWithBlend(Pawn, 0.f);
	}
	else if (APlayerCameraManager* Cam = PC->PlayerCameraManager)
	{
		Cam->SetActorLocationAndRotation(Loc, Rot);
		PC->SetViewTargetWithBlend(Cam, 0.f);
	}
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	UE_LOG(LogTemp, Log, TEXT("CarinaWorldRuntime player_pose loc=(%.1f,%.1f,%.1f) rot=(%.1f,%.1f,%.1f) ms=%.2f"),
		Loc.X, Loc.Y, Loc.Z, Rot.Pitch, Rot.Yaw, Rot.Roll, OutMs);
	return true;
}

bool UCarinaWorldRuntimeSubsystem::HighResShot(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs)
{
	const double T0 = FPlatformTime::Seconds();
	UWorld* World = GetWorld();
	if (!World)
	{
		UGameInstance* GI = GetGameInstance();
		World = GI ? GI->GetWorld() : nullptr;
	}
	if (!World)
	{
		OutError = TEXT("no UWorld");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	APlayerController* PC = World->GetFirstPlayerController();
	if (!PC)
	{
		OutError = TEXT("no PlayerController");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	const FString CmdLine = Cmd->HasField(TEXT("exec")) ? Cmd->GetStringField(TEXT("exec")) : FString(TEXT("HighResShot 1"));
	PC->ConsoleCommand(*CmdLine);
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	UE_LOG(LogTemp, Log, TEXT("CarinaWorldRuntime highresshot exec=%s ms=%.2f"), *CmdLine, OutMs);
	return true;
}

bool UCarinaWorldRuntimeSubsystem::InteractObject(const TSharedPtr<FJsonObject>& Cmd, FString& OutError, double& OutMs)
{
	const double T0 = FPlatformTime::Seconds();
	const FString ObjectId = Cmd->GetStringField(TEXT("objectId"));
	const FString Kind = Cmd->GetStringField(TEXT("kind"));
	TWeakObjectPtr<AActor>* Found = Spawned.Find(ObjectId);
	if (!Found || !Found->IsValid())
	{
		OutError = TEXT("objectId not spawned");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	AActor* Actor = Found->Get();
	UPrimitiveComponent* Prim = Cast<UPrimitiveComponent>(Actor->GetRootComponent());
	const bool bIsOpen = Actor->ActorHasTag(FName(TEXT("CarinaOpen")));
	const bool bHeld = Actor->ActorHasTag(FName(TEXT("CarinaHeld")));
	if (Kind == TEXT("open") || Kind == TEXT("close") || Kind == TEXT("use"))
	{
		const bool bOpen = Kind == TEXT("open") || (Kind == TEXT("use") && !bIsOpen);
		if (bOpen == bIsOpen && Kind != TEXT("use"))
		{
			OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
			return true;
		}
		if (bOpen)
		{
			Actor->Tags.AddUnique(FName(TEXT("CarinaOpen")));
			Actor->AddActorLocalRotation(FRotator(0.f, 90.f, 0.f));
			if (Prim)
			{
				Prim->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			}
		}
		else
		{
			Actor->Tags.Remove(FName(TEXT("CarinaOpen")));
			Actor->AddActorLocalRotation(FRotator(0.f, -90.f, 0.f));
			if (Prim)
			{
				Prim->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
				Prim->SetCollisionProfileName(TEXT("BlockAll"));
			}
		}
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return true;
	}
	if (Kind == TEXT("pickup"))
	{
		UWorld* World = Actor->GetWorld();
		APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
		APawn* Pawn = PC ? PC->GetPawn() : nullptr;
		if (!Pawn)
		{
			OutError = TEXT("no pawn for pickup");
			OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
			return false;
		}
		Actor->AttachToActor(Pawn, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
		Actor->SetActorRelativeLocation(FVector(40.f, 25.f, 40.f));
		Actor->Tags.AddUnique(FName(TEXT("CarinaHeld")));
		if (Prim)
		{
			Prim->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		}
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return true;
	}
	if (Kind == TEXT("drop"))
	{
		Actor->DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);
		Actor->Tags.Remove(FName(TEXT("CarinaHeld")));
		if (Prim)
		{
			Prim->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
			Prim->SetCollisionProfileName(TEXT("BlockAll"));
		}
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return true;
	}
	OutError = FString::Printf(TEXT("unsupported interact kind %s"), *Kind);
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	return false;
}

bool UCarinaWorldRuntimeSubsystem::DumpSpawned(const TSharedPtr<FJsonObject>& Cmd, const TSharedRef<FJsonObject>& Resp, FString& OutError, double& OutMs)
{
	(void)Cmd;
	(void)OutError;
	const double T0 = FPlatformTime::Seconds();
	TArray<TSharedPtr<FJsonValue>> Rows;
	int32 Alive = 0;
	for (const TPair<FString, TWeakObjectPtr<AActor>>& Pair : Spawned)
	{
		TSharedRef<FJsonObject> Row = MakeShared<FJsonObject>();
		Row->SetStringField(TEXT("objectId"), Pair.Key);
		AActor* Actor = Pair.Value.Get();
		if (!Actor)
		{
			Row->SetBoolField(TEXT("alive"), false);
			Rows.Add(MakeShared<FJsonValueObject>(Row));
			continue;
		}
		++Alive;
		const FVector Loc = Actor->GetActorLocation();
		const FVector Scale = Actor->GetActorScale3D();
		AStaticMeshActor* SMA = Cast<AStaticMeshActor>(Actor);
		UStaticMeshComponent* Comp = SMA ? SMA->GetStaticMeshComponent() : Actor->FindComponentByClass<UStaticMeshComponent>();
		UStaticMesh* Mesh = Comp ? Comp->GetStaticMesh() : nullptr;
		Row->SetBoolField(TEXT("hasComp"), Comp != nullptr);
		Row->SetBoolField(TEXT("hasMesh"), Mesh != nullptr);
		FBox Box(ForceInit);
		float LocalRadius = 0.f;
		if (Mesh)
		{
			Row->SetStringField(TEXT("mesh"), Mesh->GetPathName());
			LocalRadius = Mesh->GetBounds().SphereRadius;
			Box = Mesh->GetBoundingBox().TransformBy(Actor->GetActorTransform());
		}
		else
		{
			Box = Actor->GetComponentsBoundingBox(true);
		}
		Row->SetBoolField(TEXT("alive"), true);
		Row->SetStringField(TEXT("actor"), Actor->GetName());
		Row->SetNumberField(TEXT("x"), Loc.X);
		Row->SetNumberField(TEXT("y"), Loc.Y);
		Row->SetNumberField(TEXT("z"), Loc.Z);
		Row->SetNumberField(TEXT("sx"), Scale.X);
		Row->SetNumberField(TEXT("sy"), Scale.Y);
		Row->SetNumberField(TEXT("sz"), Scale.Z);
		Row->SetNumberField(TEXT("localRadius"), LocalRadius);
		Row->SetNumberField(TEXT("minX"), Box.Min.X);
		Row->SetNumberField(TEXT("minY"), Box.Min.Y);
		Row->SetNumberField(TEXT("minZ"), Box.Min.Z);
		Row->SetNumberField(TEXT("maxX"), Box.Max.X);
		Row->SetNumberField(TEXT("maxY"), Box.Max.Y);
		Row->SetNumberField(TEXT("maxZ"), Box.Max.Z);
		TArray<UBoxComponent*> Boxes;
		Actor->GetComponents<UBoxComponent>(Boxes);
		Row->SetNumberField(TEXT("boxComponents"), Boxes.Num());
		Row->SetBoolField(TEXT("hidden"), Actor->IsHidden());
		Row->SetBoolField(TEXT("actorCollision"), Actor->GetActorEnableCollision());
		if (Comp)
		{
			Row->SetNumberField(TEXT("collisionEnabled"), static_cast<double>(Comp->GetCollisionEnabled()));
		}
		Rows.Add(MakeShared<FJsonValueObject>(Row));
	}
	if (UWorld* World = GetWorld())
	{
		TArray<TSharedPtr<FJsonValue>> PawnRows;
		if (APlayerController* PC = World->GetFirstPlayerController())
		{
			if (APawn* Pawn = PC->GetPawn())
			{
				TSharedRef<FJsonObject> PawnRow = MakeShared<FJsonObject>();
				const FVector PawnLoc = Pawn->GetActorLocation();
				PawnRow->SetNumberField(TEXT("x"), PawnLoc.X);
				PawnRow->SetNumberField(TEXT("y"), PawnLoc.Y);
				PawnRow->SetNumberField(TEXT("z"), PawnLoc.Z);
				PawnRow->SetNumberField(TEXT("yaw"), Pawn->GetActorRotation().Yaw);
				PawnRow->SetStringField(TEXT("name"), Pawn->GetName());
				PawnRow->SetBoolField(TEXT("possessed"), true);
				PawnRow->SetBoolField(TEXT("collision"), Pawn->GetActorEnableCollision());
				if (ACharacter* Character = Cast<ACharacter>(Pawn))
				{
					if (UCharacterMovementComponent* Move = Character->GetCharacterMovement())
					{
						PawnRow->SetNumberField(TEXT("movementMode"), static_cast<double>(Move->MovementMode));
						PawnRow->SetBoolField(TEXT("cheatFlying"), Move->bCheatFlying);
						PawnRow->SetNumberField(TEXT("gravityScale"), Move->GravityScale);
					}
				}
				Resp->SetObjectField(TEXT("pawn"), PawnRow);
			}
		}
		if (StandProbe.IsValid())
		{
			TSharedRef<FJsonObject> StandRow = MakeShared<FJsonObject>();
			const FVector StandLoc = StandProbe->GetActorLocation();
			StandRow->SetNumberField(TEXT("x"), StandLoc.X);
			StandRow->SetNumberField(TEXT("y"), StandLoc.Y);
			StandRow->SetNumberField(TEXT("z"), StandLoc.Z);
			StandRow->SetStringField(TEXT("name"), StandProbe->GetName());
			StandRow->SetStringField(TEXT("kind"), TEXT("physics-box"));
			Resp->SetObjectField(TEXT("standPawn"), StandRow);
		}
		for (TActorIterator<APawn> It(World); It; ++It)
		{
			APawn* Candidate = *It;
			if (!Candidate)
			{
				continue;
			}
			TSharedRef<FJsonObject> Row = MakeShared<FJsonObject>();
			const FVector Loc = Candidate->GetActorLocation();
			Row->SetStringField(TEXT("name"), Candidate->GetName());
			Row->SetNumberField(TEXT("x"), Loc.X);
			Row->SetNumberField(TEXT("y"), Loc.Y);
			Row->SetNumberField(TEXT("z"), Loc.Z);
			PawnRows.Add(MakeShared<FJsonValueObject>(Row));
		}
		Resp->SetArrayField(TEXT("pawns"), PawnRows);
	}
	Resp->SetArrayField(TEXT("actors"), Rows);
	Resp->SetNumberField(TEXT("aliveCount"), Alive);
	Resp->SetNumberField(TEXT("trackedCount"), Spawned.Num());
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	return true;
}

bool UCarinaWorldRuntimeSubsystem::IsolateCarina(const TSharedPtr<FJsonObject>& Cmd, const TSharedRef<FJsonObject>& Resp, FString& OutError, double& OutMs)
{
	const double T0 = FPlatformTime::Seconds();
	UWorld* World = GetWorld();
	if (!World)
	{
		UGameInstance* GI = GetGameInstance();
		World = GI ? GI->GetWorld() : nullptr;
	}
	if (!World)
	{
		OutError = TEXT("no UWorld");
		OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
		return false;
	}
	bool bHide = true;
	if (Cmd->HasField(TEXT("hidden")))
	{
		bHide = Cmd->GetBoolField(TEXT("hidden"));
	}
	int32 Changed = 0;
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		AActor* Actor = *It;
		if (!Actor)
		{
			continue;
		}
		if (Actor->ActorHasTag(FName(TEXT("CarinaDynamic"))))
		{
			continue;
		}
		const FString ClassName = Actor->GetClass()->GetName();
		if (Actor->IsA<APawn>() || Actor->IsA<APlayerController>() || Actor->IsA<ACameraActor>())
		{
			continue;
		}
		const FString ActorName = Actor->GetName();
		if (ClassName.Contains(TEXT("Sky")) || ClassName.Contains(TEXT("Atmosphere"))
			|| ClassName.Contains(TEXT("Fog")) || ClassName.Contains(TEXT("Cloud"))
			|| ClassName.Contains(TEXT("Light")) || ClassName.Contains(TEXT("WorldSettings"))
			|| ClassName.Contains(TEXT("GameMode")) || ClassName.Contains(TEXT("GameState"))
			|| ClassName.Contains(TEXT("PlayerState")) || ClassName.Contains(TEXT("HUD"))
			|| ClassName.Contains(TEXT("PlayerCamera"))
			|| ActorName.Contains(TEXT("Sky")) || ActorName.Contains(TEXT("Light"))
			|| ActorName.Contains(TEXT("Atmosphere")) || ActorName.Contains(TEXT("Fog")))
		{
			continue;
		}
		Actor->SetActorHiddenInGame(bHide);
		Actor->SetActorEnableCollision(!bHide);
		++Changed;
	}
	for (const TPair<FString, TWeakObjectPtr<AActor>>& Pair : Spawned)
	{
		if (!Pair.Value.IsValid())
		{
			continue;
		}
		AActor* SpawnedActor = Pair.Value.Get();
		if (IsScaffoldObjectId(Pair.Key))
		{
			SpawnedActor->SetActorHiddenInGame(true);
			SpawnedActor->SetActorEnableCollision(true);
			continue;
		}
		if (!Pair.Key.Contains(TEXT("space-shell")))
		{
			continue;
		}
		if (UStaticMeshComponent* Comp = SpawnedActor->FindComponentByClass<UStaticMeshComponent>())
		{
			Comp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		}
		SpawnedActor->SetActorEnableCollision(false);
	}
	// Closed space-shell mesh blocks the default skylight. One fill light so
	// isolate is playable; not generated lighting, not a P1 pass.
	if (bHide && !FillLight.IsValid())
	{
		FActorSpawnParameters LightParams;
		LightParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		AActor* LightActor = World->SpawnActor<AActor>(AActor::StaticClass(), FVector(600.f, 500.f, 220.f), FRotator::ZeroRotator, LightParams);
		if (LightActor)
		{
			UPointLightComponent* Light = NewObject<UPointLightComponent>(LightActor, TEXT("CarinaFillLight"));
			LightActor->SetRootComponent(Light);
			Light->SetMobility(EComponentMobility::Movable);
			Light->SetIntensity(12000.f);
			Light->SetAttenuationRadius(2500.f);
			Light->SetSourceRadius(40.f);
			Light->SetCastShadows(false);
			Light->SetUseInverseSquaredFalloff(true);
			Light->RegisterComponent();
			LightActor->AddInstanceComponent(Light);
			LightActor->Tags.Add(FName(TEXT("CarinaDynamic")));
			FillLight = LightActor;
		}
	}
	Resp->SetBoolField(TEXT("hidden"), bHide);
	Resp->SetNumberField(TEXT("hiddenActors"), Changed);
	Resp->SetBoolField(TEXT("fillLight"), FillLight.IsValid());
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	UE_LOG(LogTemp, Log, TEXT("CarinaWorldRuntime isolate_carina hidden=%d changed=%d ms=%.2f"), bHide ? 1 : 0, Changed, OutMs);
	return true;
}
