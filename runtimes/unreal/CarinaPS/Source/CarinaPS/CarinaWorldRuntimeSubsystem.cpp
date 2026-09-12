
#include "CarinaWorldRuntimeSubsystem.h"
#include "Engine/World.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
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
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"

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
		Ok = PlayerPose(Cmd, Err, Ms);
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
		Comp->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		Comp->SetCollisionProfileName(TEXT("BlockAll"));
		Comp->SetSimulatePhysics(false);
		Comp->SetGenerateOverlapEvents(true);
		Comp->UpdateBounds();
		Comp->MarkRenderStateDirty();
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
	const FVector Loc = ReadVec(Cmd, TEXT("ueLocationCm"));
	const FRotator Rot = ReadRotatorDeg(Cmd);
	APawn* Pawn = PC->GetPawn();
	if (Pawn)
	{
		Pawn->SetActorLocation(Loc, false, nullptr, ETeleportType::TeleportPhysics);
		Pawn->SetActorRotation(Rot);
		if (ACharacter* Character = Cast<ACharacter>(Pawn))
		{
			if (UCharacterMovementComponent* Move = Character->GetCharacterMovement())
			{
				Move->StopMovementImmediately();
				Move->Velocity = FVector::ZeroVector;
			}
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
	}
	else
	{
		PC->SetInitialLocationAndRotation(Loc, Rot);
	}
	PC->SetControlRotation(Rot);
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
		Rows.Add(MakeShared<FJsonValueObject>(Row));
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
		if (Actor->IsA<APawn>() || Actor->IsA<APlayerController>())
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
		++Changed;
	}
	Resp->SetBoolField(TEXT("hidden"), bHide);
	Resp->SetNumberField(TEXT("hiddenActors"), Changed);
	OutMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	UE_LOG(LogTemp, Log, TEXT("CarinaWorldRuntime isolate_carina hidden=%d changed=%d ms=%.2f"), bHide ? 1 : 0, Changed, OutMs);
	return true;
}
